// The window manager (REQUIREMENTS.md §4): the only code that opens, shows,
// hides or closes windows and that chooses what the side panel shows.
//
// A pure module: the bus client and the server API are injected, so tests
// drive it with fakes. runtime.js wires it to the real ones.

import validate from '../../plugin/validate.js'
import manifestLib from '../../plugin/manifest.js'
import { T, MANAGER_TOPICS, SCOPE, VERSION, PANEL_ID, VIEWER_ID, randomId, isV1 } from './protocol.js'

const { cleanEntry, resolveUrl, MAX_ENTRIES } = validate
const { generatedButtons } = manifestLib

const WINDOW_EVENTS = ['window.closed', 'window.state', 'window.bounds']
const TITLE_BARS = ['fixed', 'autoHide']
const RETRY_START_MS = 5000
const RETRY_MAX_MS = 5 * 60 * 1000

export const MESSAGES = {
  notInstalled: 'not installed',
  limit: 'window limit reached',
  badUrl: 'invalid URL',
  listLoad: 'The app list could not be loaded from the server. Retrying…',
  conflict: 'The app list was changed elsewhere and has been reloaded. Please repeat your change.',
  forbidden: 'You do not have permission to change the app list.',
  full: `At most ${MAX_ENTRIES} apps are allowed.`,
  titleBarNotSaved: 'The title bar setting could not be saved on this device.',
  titleBarNotApplied: 'The title bar setting is saved; it applies the next time the window opens.'
}

/** An error the API layer throws for a non-2xx response. */
export class HttpError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

const reasonOf = (err) => err?.data?.reason ?? err?.reason

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const plainObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

/**
 * @param {object} deps
 * @param {object} deps.client  bus client: publish, subscribe, call, windows.*, state.*
 * @param {object} deps.api     loadApps, saveApps, loadWebapps, loadButtons, loginStatus
 * @param {string} [deps.hostName]  the host's handshake name; its own webapp is left out of the picker
 * @param {boolean} [deps.embedded]  the host page is itself framed (e.g. inside one of our apps)
 * @param {Function} [deps.setTimer]   setTimeout replacement (tests)
 * @param {Function} [deps.newId]      id generator (tests)
 */
export function createManager({ client, api, hostName = null, embedded = false, setTimer = setTimeout, newId = () => randomId() }) {
  const s = {
    entries: [],
    revision: 0,
    editLevel: 'readwrite',
    loadedButtons: null, // null: unknown, never report a pending reload
    webapps: null, // null: unknown, treat every package as installed
    canEdit: false,
    editReason: null,
    problem: null,
    panelApp: null,
    // entryId -> { windowId, status: 'open'|'hidden'|'closed'|'error', error }
    win: new Map(),
    // entryId -> error message, for side-panel entries that could not be shown
    panelErrors: new Map(),
    openApps: {},
    // entryId -> 'autoHide', per device (§4.10); absent means 'fixed'
    titleBars: {},
    started: false
  }
  let queue = Promise.resolve()
  let retryMs = RETRY_START_MS

  // Run requests one at a time, so a request never interleaves with startup
  // or with another request's window calls.
  const serial = (fn) => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => {})
    return run
  }

  const byId = (id) => s.entries.find((e) => e.id === id)
  const winOf = (id) => s.win.get(id) ?? { windowId: null, status: 'closed', error: null }
  const setWin = (id, w) => s.win.set(id, { windowId: null, status: 'closed', error: null, ...w })

  // The chartplotter's own webapp (package `freeboard-sk` or `@scope/freeboard-sk`
  // for host `freeboard-sk`) is not offered: it would open inside itself.
  const isHost = (pkg) => !!hostName && (pkg === hostName || pkg.endsWith(`/${hostName}`))

  const titleBarOf = (entry) => (s.titleBars[entry.id] === 'autoHide' ? 'autoHide' : 'fixed')

  const isInstalled = (entry) =>
    entry.source.type !== 'webapp' || s.webapps === null || s.webapps.some((w) => w.package === entry.source.package)

  // ---- snapshot -----------------------------------------------------------

  function buttonDiffs() {
    if (!s.loadedButtons) return { any: false, ids: new Set() }
    const want = generatedButtons(s.entries)
    const have = new Map(s.loadedButtons.map((b) => [b.id, b]))
    const ids = new Set()
    let any = want.length !== s.loadedButtons.length
    want.forEach((b, i) => {
      const loaded = have.get(b.id)
      const same =
        loaded &&
        loaded.title === b.title &&
        loaded.icon === b.icon &&
        sameJson(loaded.action, b.action)
      if (!same) ids.add(b.id.slice(4))
      if (!same || s.loadedButtons[i]?.id !== b.id) any = true
    })
    // an entry whose button was removed
    for (const id of have.keys()) {
      const entryId = id.slice(4)
      if (!want.some((b) => b.id === id) && byId(entryId)) ids.add(entryId)
    }
    return { any, ids }
  }

  function snapshot() {
    const diffs = buttonDiffs()
    const urls = {}
    const status = {}
    for (const e of s.entries) {
      const st = { needsReload: diffs.ids.has(e.id) }
      if (e.showIn === 'window') {
        const w = winOf(e.id)
        st.state = w.status
        st.titleBar = titleBarOf(e)
        if (w.error) st.error = w.error
      } else {
        const url = resolveUrl(e.source)
        if (url) urls[e.id] = url
        if (s.panelErrors.has(e.id)) st.error = s.panelErrors.get(e.id)
      }
      status[e.id] = st
    }
    const snap = {
      v: VERSION,
      entries: s.entries,
      urls,
      status,
      panelApp: s.panelApp,
      needsReload: diffs.any,
      canEdit: s.canEdit,
      editLevel: s.editLevel,
      webapps: (s.webapps ?? []).filter((w) => !isHost(w.package))
    }
    if (s.editReason) snap.editReason = s.editReason
    if (s.problem) snap.problem = s.problem
    return snap
  }

  const publish = (topic, params) => client.publish(topic, params, SCOPE).catch(() => {})
  const publishSnapshot = () => publish(T.snapshot, snapshot())
  const reply = (reqId, ok, extra = {}) => publish(T.reply, { v: VERSION, reqId, ok, ...extra })
  const replyError = (reqId, code, message) => reply(reqId, false, { error: { code, message } })

  // ---- per-device "remember last" ----------------------------------------

  async function persistOpenApps() {
    // An embedded chartplotter shares this device's state with the top-level
    // one; it must not overwrite what the top-level one remembers.
    if (embedded) return
    const next = {}
    for (const e of s.entries) if (e.showIn === 'window' && winOf(e.id).status === 'open') next[e.id] = true
    if (sameJson(next, s.openApps)) return
    s.openApps = next
    try {
      await client.state.set({ openApps: next }, 'extension')
    } catch {
      // best effort: only "Remember last" depends on it
    }
  }

  // Store one entry's title-bar choice (`null` drops it). The title-bar choice
  // is the user's explicit act on this device, so unlike openApps an embedded
  // chartplotter writes it too. Other contexts on this device (another tab, an
  // embedded chartplotter) share the map, so it is re-read right before the
  // write and only this entry changes. Other ids are kept even when this
  // manager does not know them: its list may be older than the tab that
  // stored them. A deleted entry's choice goes with the delete. Returns
  // whether the write succeeded; on failure (of the read too: writing the
  // startup copy could erase another tab's choice) nothing changes.
  async function storeTitleBar(entryId, mode) {
    let base
    try {
      base = plainObject((await client.state.get(['titleBars'], 'extension')).titleBars)
    } catch {
      return false
    }
    const next = {}
    for (const [id, m] of Object.entries(base)) if (m === 'autoHide' && id !== entryId) next[id] = m
    if (mode === 'autoHide') next[entryId] = mode
    try {
      await client.state.set({ titleBars: next }, 'extension')
    } catch {
      return false
    }
    s.titleBars = next
    return true
  }

  const changed = () => {
    persistOpenApps()
    publishSnapshot()
  }

  // ---- windows (§4.3) ----------------------------------------------------

  function geometryFor(entry) {
    const i = Math.max(0, s.entries.indexOf(entry)) % 8
    return { anchor: 'bottom-right', offset: { x: 16 + 32 * i, y: 16 + 32 * i }, width: 480, height: 360 }
  }

  async function openWindow(entry, { visible = true } = {}) {
    if (!isInstalled(entry)) {
      setWin(entry.id, { status: 'error', error: MESSAGES.notInstalled })
      return
    }
    const url = resolveUrl(entry.source)
    if (!url) {
      setWin(entry.id, { status: 'error', error: MESSAGES.badUrl })
      return
    }
    try {
      const state = await client.windows.open({
        panel: VIEWER_ID,
        params: { url },
        title: entry.name,
        userClose: entry.closeBehavior === 'hide' ? 'hide' : 'close',
        restoreKey: entry.id,
        geometry: geometryFor(entry),
        ...(titleBarOf(entry) === 'autoHide' ? { titleBar: 'autoHide' } : {}),
        ...(visible ? {} : { visible: false })
      })
      setWin(entry.id, { windowId: state.windowId, status: state.visible === false ? 'hidden' : 'open' })
    } catch (err) {
      const limit = reasonOf(err) === 'windows.limit'
      setWin(entry.id, { status: 'error', error: limit ? MESSAGES.limit : err.message || 'could not open' })
    }
  }

  async function closeWindowOf(entryId) {
    const w = winOf(entryId)
    s.win.delete(entryId)
    if (!w.windowId) return
    try {
      await client.windows.close(w.windowId)
    } catch {
      // already gone
    }
  }

  async function bringUp(entry) {
    const w = winOf(entry.id)
    if (w.status === 'open' && w.windowId) {
      await client.windows.focus(w.windowId).catch(() => {})
    } else if (w.status === 'hidden' && w.windowId) {
      try {
        await client.windows.update({ windowId: w.windowId, visible: true })
        setWin(entry.id, { windowId: w.windowId, status: 'open' })
        await client.windows.focus(w.windowId).catch(() => {})
      } catch (err) {
        if (reasonOf(err) === 'windows.unknownId') {
          // the window is gone (e.g. reclaimed by the host): open a new one
          await openWindow(entry)
        } else {
          // it may still exist: opening another could leave two windows
          setWin(entry.id, { windowId: w.windowId, status: 'hidden', error: err.message || 'could not show' })
        }
      }
    } else {
      await openWindow(entry)
    }
  }

  async function takeDown(entry) {
    const w = winOf(entry.id)
    if (!w.windowId || (w.status !== 'open' && w.status !== 'hidden')) {
      if (w.status === 'error') setWin(entry.id, { status: 'closed' })
      return
    }
    if (entry.closeBehavior === 'hide') {
      try {
        await client.windows.update({ windowId: w.windowId, visible: false })
        setWin(entry.id, { windowId: w.windowId, status: 'hidden' })
      } catch {
        setWin(entry.id, { status: 'closed' })
      }
    } else {
      await closeWindowOf(entry.id)
      setWin(entry.id, { status: 'closed' })
    }
  }

  /**
   * Switch an entry's title bar on this device (§4.10). The host cannot change
   * `titleBar` on an open window, so a live window is reopened in its current
   * visible/hidden state; `restoreKey` puts it back where it was. A choice
   * that cannot be stored changes nothing. If the old window does not close,
   * no second one is opened: the choice applies the next time it opens.
   * Returns `{ saved, reopened, error? }`.
   */
  async function setTitleBar(entry, mode) {
    if (titleBarOf(entry) === mode) return { saved: true, reopened: false }
    if (!(await storeTitleBar(entry.id, mode))) return { saved: false, reopened: false }
    const w = winOf(entry.id)
    if (w.windowId && (w.status === 'open' || w.status === 'hidden')) {
      const visible = w.status === 'open'
      try {
        await client.windows.close(w.windowId)
      } catch (err) {
        if (reasonOf(err) !== 'windows.unknownId') {
          return { saved: true, reopened: false, error: MESSAGES.titleBarNotApplied }
        }
      }
      s.win.delete(entry.id)
      await openWindow(entry, { visible })
      return { saved: true, reopened: true }
    }
    return { saved: true, reopened: false }
  }

  // ---- side panel (§4.9) -------------------------------------------------

  async function show(entryId) {
    if (entryId !== null) {
      const entry = byId(entryId)
      if (!entry || entry.showIn !== 'panel') return
      if (!isInstalled(entry)) {
        s.panelErrors.set(entry.id, MESSAGES.notInstalled)
        publishSnapshot()
        return
      }
      s.panelErrors.delete(entry.id)
    }
    s.panelApp = entryId
    await publishSnapshot()
    await client.call('ui.openPanel', { panel: PANEL_ID }).catch(() => {})
  }

  async function toggle(entryId) {
    if (entryId !== null && !byId(entryId)) return
    const entry = entryId === null ? null : byId(entryId)
    if (entry && entry.showIn === 'window') {
      if (winOf(entry.id).status === 'open') await takeDown(entry)
      else await bringUp(entry)
      changed()
      return
    }
    if (s.panelApp === entryId) {
      await client.call('ui.togglePanel', { panel: PANEL_ID }).catch(() => {})
    } else {
      await show(entryId)
    }
  }

  // ---- edits (§4.5) ------------------------------------------------------

  /** Bring windows and the side panel in line with a changed list. */
  async function reconcile(oldEntries, newEntries) {
    const next = new Map(newEntries.map((e) => [e.id, e]))
    for (const old of oldEntries) {
      const now = next.get(old.id)
      if (old.showIn === 'window') {
        const w = winOf(old.id)
        const live = w.windowId && (w.status === 'open' || w.status === 'hidden')
        if (!now || now.showIn !== 'window') {
          await closeWindowOf(old.id)
          continue
        }
        if (!live) {
          if (w.status === 'error') s.win.delete(old.id)
          continue
        }
        if (!sameJson(old.source, now.source) || old.closeBehavior !== now.closeBehavior) {
          const visible = w.status === 'open'
          await closeWindowOf(old.id)
          await openWindow(now, { visible })
        } else if (old.name !== now.name) {
          await client.windows.update({ windowId: w.windowId, title: now.name }).catch(() => {})
        }
      } else if (!now || now.showIn !== 'panel') {
        s.panelErrors.delete(old.id)
      }
    }
    if (s.panelApp !== null) {
      const cur = next.get(s.panelApp)
      if (!cur || cur.showIn !== 'panel') s.panelApp = null
    }
    for (const id of [...s.win.keys()]) if (!next.has(id)) s.win.delete(id)
  }

  async function putList(apps) {
    try {
      const { revision } = await api.saveApps(s.revision, apps)
      s.revision = revision
      return { ok: true }
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        await loadList()
        return { ok: false, code: 'conflict', message: MESSAGES.conflict }
      }
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        s.canEdit = false
        s.editReason = MESSAGES.forbidden
        return { ok: false, code: 'forbidden', message: MESSAGES.forbidden }
      }
      if (err instanceof HttpError && err.status === 400) {
        return { ok: false, code: 'invalid', message: err.message }
      }
      return { ok: false, code: 'error', message: err.message || 'Saving failed.' }
    }
  }

  async function saveEntry(raw) {
    let entry
    try {
      entry = cleanEntry(raw, { requireId: false })
    } catch (err) {
      return { ok: false, code: 'invalid', message: err.message }
    }
    const isNew = !entry.id
    if (isNew) {
      if (s.entries.length >= MAX_ENTRIES) return { ok: false, code: 'invalid', message: MESSAGES.full }
      let id
      do id = newId()
      while (byId(id))
      entry = { id, ...entry }
    } else if (!byId(entry.id)) {
      return { ok: false, code: 'conflict', message: MESSAGES.conflict }
    }
    const old = s.entries
    const apps = isNew ? [...old, entry] : old.map((e) => (e.id === entry.id ? entry : e))
    const res = await putList(apps)
    if (!res.ok) return res
    s.entries = apps
    await reconcile(old, apps)
    return { ok: true, entryId: entry.id }
  }

  async function deleteEntry(entryId) {
    if (!byId(entryId)) return { ok: true }
    const old = s.entries
    const apps = old.filter((e) => e.id !== entryId)
    const res = await putList(apps)
    if (!res.ok) return res
    s.entries = apps
    await reconcile(old, apps)
    await storeTitleBar(entryId, null) // best effort; another tab may have set it
    return { ok: true }
  }

  // ---- loading and startup (§4.1, §4.2) ----------------------------------

  async function loadList() {
    const old = s.entries
    try {
      const data = await api.loadApps()
      s.entries = Array.isArray(data.apps) ? data.apps : []
      s.revision = data.revision ?? 0
      if (data.editLevel) s.editLevel = data.editLevel
      s.problem = null
      retryMs = RETRY_START_MS
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
        s.problem = 'You do not have permission to read the app list on this server.'
      } else {
        s.problem = MESSAGES.listLoad
      }
      return false
    }
    await reconcile(old, s.entries)
    return true
  }

  async function loadWebapps() {
    try {
      s.webapps = await api.loadWebapps()
    } catch {
      s.webapps = null
    }
  }

  async function loadEditRights() {
    try {
      const st = await api.loginStatus()
      if (st.authenticationRequired === false) {
        s.canEdit = true
      } else {
        const level = st.userLevel
        s.canEdit = level === 'admin' || (level === 'readwrite' && s.editLevel === 'readwrite')
      }
      s.editReason = s.canEdit
        ? null
        : st.status === 'loggedIn'
          ? MESSAGES.forbidden
          : 'Log in to the Signal K server to add or change apps.'
    } catch {
      s.canEdit = false
      s.editReason = 'Could not check your permissions on the Signal K server.'
    }
  }

  async function applyStartup() {
    // A chartplotter shown inside another page (for example inside an app this
    // extension opened, such as a KIP dashboard that embeds the chartplotter)
    // opens nothing by itself: it would read the same "Remember last" state
    // and reopen that app inside itself, recursively.
    if (embedded) return
    for (const e of s.entries) {
      if (e.showIn !== 'window') continue
      const open = e.startup === 'always' || (e.startup === 'remember' && s.openApps[e.id] === true)
      if (open) await openWindow(e)
    }
  }

  function scheduleRetry() {
    setTimer(() => {
      serial(async () => {
        const ok = await loadList()
        if (ok && !s.started) {
          s.started = true
          await applyStartup()
          persistOpenApps()
        } else if (!ok) {
          retryMs = Math.min(retryMs * 2, RETRY_MAX_MS)
          scheduleRetry()
        }
        publishSnapshot()
      })
    }, retryMs)
  }

  // ---- incoming --------------------------------------------------------

  function onWindowEvent(name, params) {
    if (!params || typeof params.windowId !== 'string') return
    let id = null
    for (const [entryId, w] of s.win) if (w.windowId === params.windowId) id = entryId
    if (id === null) return
    if (name === 'window.closed') {
      setWin(id, { status: 'closed' })
      changed()
    } else if (name === 'window.state') {
      const status = params.visible === false ? 'hidden' : 'open'
      if (winOf(id).status !== status) {
        setWin(id, { windowId: params.windowId, status })
        changed()
      }
    }
    // window.bounds: the host remembers geometry under restoreKey; nothing to do
  }

  function onMessage(topic, params) {
    if (!isV1(params)) return
    switch (topic) {
      case T.hello:
        // queued behind startup, so a side panel opened while the list is
        // still loading does not see an empty list first
        serial(publishSnapshot)
        break
      case T.toggle:
        serial(() => toggle(params.entryId ?? null))
        break
      case T.setOpen:
        serial(async () => {
          const id = params.entryId ?? null
          const entry = id === null ? null : byId(id)
          if (id !== null && !entry) return replyError(params.reqId, 'unknown', 'This app no longer exists.')
          if (entry && entry.showIn === 'window') {
            if (params.open) await bringUp(entry)
            else await takeDown(entry)
            changed()
          } else if (params.open) {
            await show(id)
          }
          const err = entry && (entry.showIn === 'window' ? winOf(entry.id).error : s.panelErrors.get(entry.id))
          if (err) await replyError(params.reqId, 'open', err)
          else await reply(params.reqId, true)
        })
        break
      case T.setTitleBar:
        serial(async () => {
          const entry = byId(params.entryId)
          if (!entry) return replyError(params.reqId, 'unknown', 'This app no longer exists.')
          if (entry.showIn !== 'window' || !TITLE_BARS.includes(params.titleBar)) {
            return replyError(params.reqId, 'invalid', 'Only a window app has a title bar to hide.')
          }
          const { saved, reopened, error } = await setTitleBar(entry, params.titleBar)
          changed()
          const err = error || (reopened && winOf(entry.id).error)
          if (!saved) await replyError(params.reqId, 'state', MESSAGES.titleBarNotSaved)
          else if (err) await replyError(params.reqId, 'open', err)
          else await reply(params.reqId, true)
        })
        break
      case T.saveEntry:
        serial(async () => {
          const res = await saveEntry(params.entry)
          changed()
          if (res.ok) await reply(params.reqId, true, { entryId: res.entryId })
          else await replyError(params.reqId, res.code, res.message)
        })
        break
      case T.deleteEntry:
        serial(async () => {
          const res = await deleteEntry(params.entryId)
          changed()
          if (res.ok) await reply(params.reqId, true)
          else await replyError(params.reqId, res.code, res.message)
        })
        break
      case T.reload:
        serial(async () => {
          await Promise.all([loadList(), loadWebapps(), loadEditRights()])
          changed()
          await reply(params.reqId, true)
        })
        break
    }
  }

  async function start() {
    await client.subscribe(MANAGER_TOPICS, onMessage)
    await client.subscribe(WINDOW_EVENTS, onWindowEvent)
    return serial(async () => {
      try {
        const values = await client.state.get(['openApps', 'titleBars'], 'extension')
        s.openApps = plainObject(values.openApps)
        s.titleBars = plainObject(values.titleBars)
      } catch {
        s.openApps = {}
        s.titleBars = {}
      }
      const [ok] = await Promise.all([
        loadList(),
        loadWebapps(),
        api.loadButtons().then(
          (b) => (s.loadedButtons = b),
          () => (s.loadedButtons = null)
        )
      ])
      await loadEditRights()
      if (ok) {
        s.started = true
        await applyStartup()
        await persistOpenApps()
      } else {
        scheduleRetry()
      }
      publishSnapshot()
    })
  }

  return { start, snapshot, state: s, onMessage, onWindowEvent, idle: () => queue }
}

