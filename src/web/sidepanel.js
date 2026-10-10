// Side panel `app-panel` (REQUIREMENTS.md §8, §9.2): the extension's only
// drawer panel. Shows the launcher view (the app list and the per-app
// configuration) or one side-panel app in a child iframe, whichever the
// window manager chose. Never opens a window or switches what it shows on
// its own: every request goes to the window manager over the bus, and every
// change comes back as a snapshot.

import { connectExtension } from 'signalk-plotterext-bus/extension'
import validate from '../../plugin/validate.js'
import SVG from 'icons:svg'
import { BUTTON_ICONS, RETIRED_ICONS } from './icon-list.js'
import { createFrames } from './frames.js'
import { panelAppIds, stepApp } from './nav.js'
import { T, PANEL_TOPICS, SCOPE, VERSION, randomId, isV1 } from './protocol.js'

const { cleanEntry, resolveUrl, MAX_ENTRIES } = validate

const HELLO_TIMEOUT_MS = 3000
const REPLY_TIMEOUT_MS = 10000
const ICON_LABELS = new Map([...BUTTON_ICONS, ...RETIRED_ICONS])

// ---- tiny DOM helpers ------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k in el && typeof v !== 'string') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

function icon(name, cls = 'icon') {
  const span = h('span', { class: cls })
  span.innerHTML = SVG[name] ?? '' // build-time SVG from the Material icon set
  return span
}

// ---- state -----------------------------------------------------------------

let client
let snap = null // latest snapshot from the window manager
let view = 'list' // 'list' | 'edit'
let form = null // the configuration form's state while view === 'edit'
const pending = new Map() // reqId -> callback(reply)

const root = document.getElementById('root')
const navbar = h('div', { class: 'navbar', hidden: true })
const launcher = h('div', { class: 'launcher' })
const framesBox = h('div', { class: 'frames' })
root.append(navbar, launcher, framesBox)
let frames = null

// ---- bus -------------------------------------------------------------------

// A publish resolves whether or not anyone heard it, so a request whose reply
// never comes (the window manager is gone) fails after REPLY_TIMEOUT_MS
// instead of leaving the form on "Saving…".
function send(topic, params, onReply) {
  const reqId = randomId(16)
  const settle = (reply) => {
    if (!pending.has(reqId)) return
    clearTimeout(pending.get(reqId).timer)
    pending.delete(reqId)
    onReply?.(reply)
  }
  const timer = setTimeout(
    () => settle({ ok: false, error: { code: 'timeout', message: 'The Companion Apps manager did not respond. Reload the chartplotter.' } }),
    REPLY_TIMEOUT_MS
  )
  pending.set(reqId, { settle, timer })
  client.publish(topic, { v: VERSION, reqId, ...params }, SCOPE).catch((err) => {
    settle({ ok: false, error: { code: 'bus', message: err.message } })
  })
  return reqId
}

// Re-read the list, the installed webapps and the user's rights (e.g. after
// logging in once the chartplotter was already loaded).
let refreshing = false
function refresh() {
  if (refreshing || !snap) return
  refreshing = true
  render()
  send(T.reload, {}, () => {
    refreshing = false
    render()
  })
}

let helloTimer = null
let managerMissing = false
function hello() {
  client.publish(T.hello, { v: VERSION }, SCOPE).catch(() => {})
  clearTimeout(helloTimer)
  helloTimer = setTimeout(() => {
    if (snap) return
    managerMissing = true
    render()
    hello()
  }, HELLO_TIMEOUT_MS)
}

function onMessage(topic, params) {
  if (!isV1(params)) return
  if (topic === T.snapshot) {
    snap = params
    managerMissing = false
    clearTimeout(helloTimer)
    frames.applySnapshot(snap)
    renderNavbar()
    if (view === 'edit' && form.id && !snap.entries.some((e) => e.id === form.id)) {
      view = 'list' // the entry being edited was deleted
      form = null
    }
    // Re-rendering the form would take the focus out of a field being typed
    // in; its state lives in `form`, so only the list follows snapshots.
    if (view === 'list') render()
  } else if (topic === T.reply) {
    pending.get(params.reqId)?.settle(params)
  }
}

// ---- navigation bar ------------------------------------------------------------

// Shown while at least one side-panel app exists: previous / next arrows that
// cycle through the side-panel apps, the name of what is showing, and a gear
// that returns to the App Manager (the launcher view). Every press is a
// request to the window manager; the bar follows the snapshot it sends back.

let navError = null
let navErrorTimer = null

function go(entryId) {
  navError = null
  send(T.setOpen, { entryId, open: true }, (r) => {
    if (r.ok) return
    const name = snap?.entries.find((e) => e.id === entryId)?.name ?? 'App'
    navError = `${name}: ${r.error?.message ?? 'could not be shown'}`
    clearTimeout(navErrorTimer)
    navErrorTimer = setTimeout(() => {
      navError = null
      renderNavbar()
    }, 4000)
    renderNavbar()
  })
}

function renderNavbar() {
  const ids = snap ? panelAppIds(snap.entries) : []
  navbar.hidden = ids.length === 0
  document.body.classList.toggle('has-navbar', !navbar.hidden)
  if (navbar.hidden) return
  navbar.textContent = ''
  const current = ids.includes(snap.panelApp) ? snap.panelApp : null
  const entry = current && snap.entries.find((e) => e.id === current)
  const prev = stepApp(ids, current, -1)
  const next = stepApp(ids, current, +1)
  const nameOf = (id) => (id === null ? 'App Manager' : snap.entries.find((e) => e.id === id)?.name)
  navbar.append(
    h(
      'button',
      {
        class: 'icon-btn nav-prev',
        disabled: prev === undefined,
        title: `Previous: ${nameOf(prev)}`,
        'aria-label': 'Previous app',
        onclick: () => go(prev)
      },
      icon('chevron_left')
    ),
    h(
      'div',
      { class: `nav-label${navError ? ' error' : ''}`, role: 'status' },
      navError ? null : entry?.icon ? icon(entry.icon, 'icon nav-icon') : !entry ? icon('settings', 'icon nav-icon') : null,
      h('span', { class: 'nav-name' }, navError ?? (entry ? entry.name : 'App Manager'))
    ),
    h(
      'button',
      {
        class: 'icon-btn nav-next',
        disabled: next === undefined,
        title: `Next: ${nameOf(next)}`,
        'aria-label': 'Next app',
        onclick: () => go(next)
      },
      icon('chevron_right')
    ),
    h(
      'button',
      {
        class: 'icon-btn nav-manager',
        disabled: current === null,
        title: 'App Manager',
        'aria-label': 'App Manager',
        onclick: () => go(null)
      },
      icon('settings')
    )
  )
}

// ---- launcher: list ----------------------------------------------------------

let listError = null
const titleBarBusy = new Set() // entry ids with a setTitleBar request in flight

function render() {
  if (view === 'edit' && form) renderForm()
  else renderList()
}

function banner(text, kind = 'info', ...extra) {
  return h('div', { class: `banner ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text, ...extra)
}

function retryButton() {
  return h('button', { class: 'link-btn', disabled: refreshing, onclick: refresh }, refreshing ? 'Checking…' : 'Check again')
}

function entryIcon(entry) {
  return entry.icon ? icon(entry.icon, 'icon entry-icon') : null
}

function hintFor(entry, st) {
  if (st?.error) return h('span', { class: 'hint error' }, st.error)
  if (entry.showIn === 'panel') return h('span', { class: 'hint' }, 'side panel')
  if (st?.state === 'hidden') return h('span', { class: 'hint' }, 'running hidden')
  return null
}

// The title-bar switch of a window entry (§4.10): a per-device choice, so it
// sits on the row (one tap, no edit rights needed) rather than in the form,
// which edits the boat's list. Pressed means the title bar hides when idle.
function titleBarToggle(e, st) {
  const bare = st.titleBar === 'autoHide'
  const live = st.state === 'open' || st.state === 'hidden'
  const tip = bare
    ? `${e.name}: the title bar hides when idle on this device. Press to keep it shown.`
    : `${e.name}: hide the title bar when idle on this device.`
  return h(
    'button',
    {
      class: `icon-btn title-bar${bare ? ' on' : ''}`,
      'aria-pressed': String(bare),
      'aria-label': `Hide the ${e.name} title bar when idle`,
      title: live ? `${tip} The open window reloads.` : tip,
      disabled: titleBarBusy.has(e.id),
      onclick: () => {
        listError = null
        titleBarBusy.add(e.id)
        render()
        send(T.setTitleBar, { entryId: e.id, titleBar: bare ? 'fixed' : 'autoHide' }, (r) => {
          titleBarBusy.delete(e.id)
          if (!r.ok) listError = `${e.name}: ${r.error?.message ?? 'failed'}`
          if (view === 'list') render()
        })
      }
    },
    icon(bare ? 'web_asset_off' : 'web_asset')
  )
}

function renderList() {
  launcher.textContent = ''
  if (managerMissing && !snap) {
    launcher.append(banner('The Companion Apps manager is not running. Reload the chartplotter.', 'error'))
    return
  }
  if (!snap) {
    launcher.append(h('p', { class: 'muted' }, 'Loading…'))
    return
  }
  if (snap.problem) launcher.append(banner(snap.problem, 'error', retryButton()))
  if (snap.needsReload) launcher.append(banner('Reload the chartplotter to update the toolbar buttons.'))
  if (listError) launcher.append(banner(listError, 'error'))

  const list = h('ul', { class: 'apps' })
  for (const e of snap.entries) {
    const st = snap.status[e.id] ?? {}
    // One button per row, labelled with what pressing it does. A window entry
    // reflects what is on screen: Open (closed), Close / Hide (open, by close
    // behavior), Show (hidden). The snapshot, not the press, changes the label.
    const isWindow = e.showIn === 'window'
    const onScreen = isWindow && st.state === 'open'
    const action = !isWindow
      ? 'Open'
      : onScreen
        ? e.closeBehavior === 'hide'
          ? 'Hide'
          : 'Close'
        : st.state === 'hidden'
          ? 'Show'
          : 'Open'
    const control = h(
      'button',
      {
        class: `open-btn${onScreen ? ' on-screen' : ''}`,
        title: isWindow ? `${action} the ${e.name} window` : `Show ${e.name} in the side panel`,
        onclick: () => {
          listError = null
          send(T.setOpen, { entryId: e.id, open: !onScreen }, (r) => {
            if (!r.ok) {
              listError = `${e.name}: ${r.error?.message ?? 'failed'}`
              render()
            }
          })
        }
      },
      action
    )
    list.append(
      h(
        'li',
        { class: 'app-row' },
        h('span', { class: 'control' }, control),
        entryIcon(e),
        h('span', { class: 'name' }, h('span', { class: 'label' }, e.name), hintFor(e, st)),
        isWindow ? titleBarToggle(e, st) : null,
        h(
          'button',
          { class: 'icon-btn info', title: `Configure ${e.name}`, 'aria-label': `Configure ${e.name}`, onclick: () => openForm(e) },
          icon('info')
        )
      )
    )
  }
  const full = snap.entries.length >= MAX_ENTRIES
  list.append(
    h(
      'li',
      { class: 'app-row add-row' },
      h(
        'button',
        {
          class: 'add-btn',
          disabled: !snap.canEdit || full,
          title: !snap.canEdit ? snap.editReason ?? 'Editing is unavailable.' : full ? `At most ${MAX_ENTRIES} apps.` : null,
          onclick: () => openForm(null)
        },
        icon('add'),
        'Add new application'
      )
    )
  )
  launcher.append(list)
  if (!snap.canEdit) {
    launcher.append(h('p', { class: 'muted small' }, snap.editReason ?? 'Editing is unavailable.', ' ', retryButton()))
  }
  if (snap.entries.length === 0) {
    launcher.append(
      h('p', { class: 'muted small' }, 'Add a webapp or a web page to show it in a window over the chart or in this side panel.')
    )
  }
}

// ---- launcher: configuration -------------------------------------------------

const defaultWebapp = () => (snap?.webapps ?? [])[0]?.package ?? ''

function openForm(entry) {
  listError = null
  const webapps = snap?.webapps ?? []
  if (entry) {
    form = {
      id: entry.id,
      kind: entry.source.type,
      package: entry.source.type === 'webapp' ? entry.source.package : defaultWebapp(),
      suffix: entry.source.type === 'webapp' ? entry.source.suffix ?? '' : '',
      url: entry.source.type === 'url' ? entry.source.url : '',
      name: entry.name,
      nameEdited: true,
      showIn: entry.showIn,
      closeBehavior: entry.closeBehavior,
      startup: entry.startup,
      titleBar: snap?.status[entry.id]?.titleBar ?? 'fixed',
      icon: entry.icon ?? '',
      error: null,
      busy: false,
      confirmDelete: false
    }
  } else {
    const pkg = defaultWebapp()
    form = {
      id: null,
      kind: webapps.length ? 'webapp' : 'url',
      package: pkg,
      suffix: '',
      url: '',
      name: webapps.find((w) => w.package === pkg)?.name ?? '',
      nameEdited: false,
      showIn: 'window',
      closeBehavior: 'unload',
      startup: 'remember',
      titleBar: 'fixed',
      icon: '',
      error: null,
      busy: false,
      confirmDelete: false
    }
  }
  view = 'edit'
  render()
}

function closeForm() {
  view = 'list'
  form = null
  render()
}

function formEntry() {
  const source =
    form.kind === 'webapp'
      ? { type: 'webapp', package: form.package, ...(form.suffix.trim() ? { suffix: form.suffix.trim() } : {}) }
      : { type: 'url', url: form.url.trim() }
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name,
    source,
    showIn: form.showIn,
    closeBehavior: form.closeBehavior,
    startup: form.startup,
    ...(form.icon ? { icon: form.icon } : {})
  }
}

function save() {
  let entry
  try {
    entry = cleanEntry(formEntry(), { requireId: false })
  } catch (err) {
    form.error = err.message
    renderForm()
    return
  }
  form.busy = true
  form.error = null
  renderForm()
  const f = form
  send(T.saveEntry, { entry }, (r) => {
    if (form !== f) return
    f.busy = false
    if (r.ok) {
      applyTitleBar(r.entryId ?? f.id, f)
      closeForm()
    } else {
      f.error = r.error?.message ?? 'Saving failed.'
      renderForm()
    }
  })
}

// The form's Title bar field is not part of the entry (it is per device,
// §4.10): once the entry is saved, it goes to the window manager like the
// row's switch.
function applyTitleBar(entryId, f) {
  if (!entryId || f.showIn !== 'window') return
  if ((snap?.status[entryId]?.titleBar ?? 'fixed') === f.titleBar) return
  send(T.setTitleBar, { entryId, titleBar: f.titleBar }, (r) => {
    if (r.ok) return
    listError = `${f.name}: ${r.error?.message ?? 'failed'}`
    if (view === 'list') render()
  })
}

function remove() {
  const f = form
  f.busy = true
  renderForm()
  send(T.deleteEntry, { entryId: f.id }, (r) => {
    if (form !== f) return
    f.busy = false
    if (r.ok) closeForm()
    else {
      f.error = r.error?.message ?? 'Deleting failed.'
      f.confirmDelete = false
      renderForm()
    }
  })
}

function radio(name, value, current, label, onPick) {
  return h(
    'label',
    { class: 'radio' },
    h('input', { type: 'radio', name, value, checked: value === current, onchange: () => onPick(value) }),
    label
  )
}

function field(label, ...content) {
  return h('div', { class: 'field' }, h('div', { class: 'field-label' }, label), ...content)
}

/** The toolbar-button icon picker: a drop-down list of icons with their names. */
function iconPicker() {
  const current = form.icon
  const optionContent = (name) =>
    name
      ? [icon(name), h('span', { class: 'opt-label' }, ICON_LABELS.get(name) ?? name)]
      : [icon('block'), h('span', { class: 'opt-label' }, 'None')]
  const wrap = h('div', { class: 'icon-picker' })
  const list = h('ul', { class: 'icon-options', role: 'listbox', hidden: true, tabindex: '-1' })
  const trigger = h(
    'button',
    {
      type: 'button',
      class: 'icon-trigger',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      disabled: form.busy,
      onclick: () => setOpen(list.hidden)
    },
    ...optionContent(current),
    icon('arrow_drop_down', 'icon caret')
  )
  const setOpen = (open) => {
    list.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    if (!open) return
    // Open upward when the panel has no room below the trigger.
    const box = launcher.getBoundingClientRect()
    const t = trigger.getBoundingClientRect()
    list.classList.toggle('up', box.bottom - t.bottom < Math.min(280, list.scrollHeight) && t.top - box.top > box.bottom - t.bottom)
    ;(list.querySelector('[aria-selected="true"]') ?? list.firstChild)?.focus({ preventScroll: true })
  }
  const pick = (name) => {
    form.icon = name
    renderForm()
    document.querySelector('.icon-trigger')?.focus()
  }
  for (const name of ['', ...BUTTON_ICONS.map(([n]) => n)]) {
    const li = h(
      'li',
      {
        role: 'option',
        class: 'icon-option',
        tabindex: '-1',
        'aria-selected': String(name === current),
        onclick: () => pick(name),
        onkeydown: (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault()
            pick(name)
          } else if (ev.key === 'ArrowDown') {
            ev.preventDefault()
            li.nextSibling?.focus()
          } else if (ev.key === 'ArrowUp') {
            ev.preventDefault()
            li.previousSibling?.focus()
          } else if (ev.key === 'Escape') {
            setOpen(false)
            trigger.focus()
          }
        }
      },
      ...optionContent(name)
    )
    list.append(li)
  }
  wrap.addEventListener('focusout', (ev) => {
    if (!wrap.contains(ev.relatedTarget)) setOpen(false)
  })
  wrap.append(trigger, list)
  return wrap
}

function renderForm() {
  const f = form
  const webapps = snap?.webapps ?? []
  const isNew = !f.id
  const canEdit = !!snap?.canEdit
  launcher.textContent = ''

  const header = h(
    'div',
    { class: 'form-header' },
    h('button', { class: 'icon-btn', title: 'Back', 'aria-label': 'Back', onclick: closeForm }, icon('arrow_back')),
    h('h2', {}, isNew ? 'Add application' : f.name || 'Application')
  )
  launcher.append(header)
  if (!canEdit) launcher.append(banner(snap?.editReason ?? 'Editing is unavailable.', 'warn'))

  // 1. Show
  const pickWebapp = (pkg) => {
    f.package = pkg
    if (!f.nameEdited) f.name = webapps.find((w) => w.package === pkg)?.name ?? ''
    renderForm()
  }
  const knownPkg = webapps.some((w) => w.package === f.package)
  const webappSelect = h(
    'select',
    { 'aria-label': 'Webapp', disabled: f.kind !== 'webapp', onchange: (ev) => pickWebapp(ev.target.value) },
    ...(knownPkg || !f.package ? [] : [h('option', { value: f.package, selected: true }, `${f.package} (not installed)`)]),
    ...webapps.map((w) => h('option', { value: w.package, selected: w.package === f.package }, w.name))
  )
  const suffixInput = h('input', {
    type: 'text',
    value: f.suffix,
    placeholder: 'e.g. #/page/1 or ?param=value',
    'aria-label': 'Extra path or parameters',
    disabled: f.kind !== 'webapp',
    oninput: (ev) => (f.suffix = ev.target.value)
  })
  const urlInput = h('input', {
    type: 'url',
    value: f.url,
    placeholder: 'https://example.com/ or /path/on/this/server/',
    'aria-label': 'URL',
    disabled: f.kind !== 'url',
    oninput: (ev) => {
      f.url = ev.target.value
      mixed.hidden = !isMixed()
    }
  })
  const isMixed = () => location.protocol === 'https:' && f.url.trim().startsWith('http:')
  const mixed = h('p', { class: 'hint warn', hidden: !isMixed() }, 'This chartplotter is on https, so the browser will block an http page.')
  launcher.append(
    field(
      'Open',
      h(
        'div',
        { class: 'choice' },
        radio('kind', 'webapp', f.kind, 'An installed webapp', (v) => {
          f.kind = v
          renderForm()
        }),
        h('div', { class: 'sub' }, webapps.length ? webappSelect : h('p', { class: 'muted small' }, 'No webapps found on the server.'),
          h('label', { class: 'sub-label' }, 'Extra path or parameters (optional)'), suffixInput),
        radio('kind', 'url', f.kind, 'A web page (URL)', (v) => {
          f.kind = v
          renderForm()
        }),
        h(
          'div',
          { class: 'sub' },
          urlInput,
          h('p', { class: 'hint' }, 'Pages on this Signal K server always work. Other sites must allow being shown inside another page.'),
          mixed
        )
      )
    )
  )

  // 2. Name
  launcher.append(
    field(
      'Name',
      h('input', {
        type: 'text',
        value: f.name,
        maxlength: '80',
        'aria-label': 'Name',
        oninput: (ev) => {
          f.name = ev.target.value
          f.nameEdited = true
        }
      })
    )
  )

  // 3. Show in
  const pickShowIn = (v) => {
    if (v === f.showIn) return
    // Side-panel apps never open at startup; keep the window choice (even
    // "Never open") in case the user switches back.
    if (v === 'panel') {
      f.windowStartup = f.startup
      f.startup = 'never'
    } else {
      f.startup = f.windowStartup ?? 'remember'
    }
    f.showIn = v
    renderForm()
  }
  launcher.append(
    field(
      'Open in',
      h(
        'div',
        { class: 'choice' },
        radio('showIn', 'window', f.showIn, 'Window (floats over the chart)', pickShowIn),
        radio('showIn', 'panel', f.showIn, 'Side panel', pickShowIn)
      )
    )
  )

  // 4. Close behavior
  const explain =
    f.showIn === 'window'
      ? { unload: 'The close button closes the app.', hide: 'The app keeps running hidden; open it again to bring it back.' }
      : { unload: 'The app stops when you leave it.', hide: 'The app keeps running while not shown.' }
  const pickClose = (v) => {
    f.closeBehavior = v
    renderForm()
  }
  launcher.append(
    field(
      'Close behavior',
      h(
        'div',
        { class: 'choice' },
        radio('close', 'unload', f.closeBehavior, 'Unload', pickClose),
        radio('close', 'hide', f.closeBehavior, 'Hide', pickClose),
        h('p', { class: 'hint' }, explain[f.closeBehavior])
      )
    )
  )

  // 5. At startup (windows only: side-panel apps never open at startup)
  if (f.showIn === 'window') {
    launcher.append(
      field(
        'At startup',
        h(
          'select',
          { 'aria-label': 'At startup', onchange: (ev) => (f.startup = ev.target.value) },
          ...[
            ['always', 'Always open'],
            ['remember', 'Remember last'],
            ['never', 'Never open']
          ].map(([v, l]) => h('option', { value: v, selected: v === f.startup }, l))
        )
      )
    )
  }

  // 6. Title bar (windows only; per device, §4.10)
  if (f.showIn === 'window') {
    const pickTitleBar = (v) => {
      f.titleBar = v
      renderForm()
    }
    launcher.append(
      field(
        'Title bar',
        h(
          'div',
          { class: 'choice' },
          radio('titleBar', 'fixed', f.titleBar, 'Always shown', pickTitleBar),
          radio('titleBar', 'autoHide', f.titleBar, 'Hide when idle', pickTitleBar),
          h(
            'p',
            { class: 'hint' },
            f.titleBar === 'autoHide'
              ? 'The title bar fades away when not in use; touch or hover the top edge of the window to bring it back. '
              : '',
            'Set for this device only; also the window icon in the app list.'
          )
        )
      )
    )
  }

  // 7. Toolbar button
  launcher.append(
    field(
      'Toolbar button',
      iconPicker(),
      h('p', { class: 'hint' }, 'A button appears on the chartplotter toolbar after the chartplotter is reloaded.')
    )
  )

  if (f.error) launcher.append(banner(f.error, 'error'))

  // 8. Save / Cancel / Delete
  const actions = h('div', { class: 'actions' })
  if (f.confirmDelete) {
    actions.append(
      h('span', { class: 'confirm-text' }, `Delete "${f.name}"?`),
      h('button', { class: 'danger', disabled: f.busy, onclick: remove }, 'Delete'),
      h('button', { disabled: f.busy, onclick: () => ((f.confirmDelete = false), renderForm()) }, 'Keep')
    )
  } else {
    actions.append(
      h('button', { class: 'primary', disabled: f.busy || !canEdit, onclick: save }, f.busy ? 'Saving…' : 'Save'),
      h('button', { disabled: f.busy, onclick: closeForm }, 'Cancel')
    )
    if (!isNew) {
      actions.append(
        h('span', { class: 'spacer' }),
        h('button', { class: 'danger', disabled: f.busy || !canEdit, onclick: () => ((f.confirmDelete = true), renderForm()) }, 'Delete')
      )
    }
  }
  launcher.append(actions)

  // Keep a resolved preview so the user sees where the app points.
  const preview = (() => {
    try {
      return resolveUrl(cleanEntry(formEntry(), { requireId: false }).source)
    } catch {
      return null
    }
  })()
  if (preview) launcher.append(h('p', { class: 'muted small url-preview' }, `Opens ${preview}`))
}

// ---- start -------------------------------------------------------------------

async function main() {
  client = await connectExtension()
  const hasVisibility = client.hasCapability('panels.state')
  frames = createFrames({ container: framesBox, launcher, hasVisibility })
  await client.subscribe(PANEL_TOPICS, onMessage)

  if (hasVisibility) {
    const own = client.context.id
    await client.subscribe(['panel.state'], (_n, p) => {
      if (p?.panel !== own) return
      frames.setVisible(p.visible !== false)
      // Showing the App Manager: pick up a login or list change made since.
      if (p.visible !== false && snap?.panelApp === null) refresh()
    })
    try {
      const mine = (await client.panels.list()).find((p) => p.panel === own)
      if (mine) frames.setVisible(mine.visible !== false)
    } catch {
      // keep the default (visible)
    }
  }

  if (client.hasCapability('nightMode')) {
    const apply = (st) => document.body.classList.toggle('night', !!st?.enabled)
    client.subscribe(['nightMode.changed'], (_n, p) => apply(p)).catch(() => {})
    client.nightMode.get().then(apply, () => {})
  }

  render()
  hello()
}

main().catch((err) => {
  console.warn('Companion Apps side panel could not connect:', err)
  launcher.textContent = ''
  launcher.append(banner('Companion Apps could not connect to the chartplotter.', 'error'))
})
