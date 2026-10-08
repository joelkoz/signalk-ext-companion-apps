// Window manager (§4) driven by a fake bus client and a fake server API.

import { test } from 'node:test'
import assert from 'node:assert'
import { createManager, HttpError, MESSAGES } from '../src/web/manager.js'
import { T, MANAGER_TOPICS } from '../src/web/protocol.js'

const PFX = 'signalk-ext-companion-apps.'

const entry = (id, extra = {}) => ({
  id,
  name: `App ${id}`,
  source: { type: 'webapp', package: 'app-' + id },
  showIn: 'window',
  closeBehavior: 'unload',
  startup: 'never',
  ...extra
})
const panelEntry = (id, extra = {}) => entry(id, { showIn: 'panel', ...extra })

function fakeClient({ openApps = {}, limit = Infinity } = {}) {
  let n = 0
  const c = {
    log: [],
    published: [],
    subs: [],
    windows: new Map(),
    stateValues: { openApps },
    async publish(topic, params, scope) {
      c.published.push({ topic, params, scope })
    },
    async subscribe(patterns, handler) {
      c.subs.push({ patterns, handler })
      return async () => {}
    },
    async call(method, params) {
      c.log.push([method, params])
      return {}
    },
    windows: {
      async open(p) {
        c.log.push(['open', p])
        if (c.openWins.size >= limit) {
          const e = new Error('limit')
          e.data = { reason: 'windows.limit' }
          throw e
        }
        const windowId = `w${++n}`
        c.openWins.set(windowId, p)
        return { windowId, visible: p.visible !== false }
      },
      async update(p) {
        c.log.push(['update', p])
        if (c.failUpdate) throw new Error(c.failUpdate)
        if (!c.openWins.has(p.windowId)) {
          const e = new Error('unknown window')
          e.data = { reason: 'windows.unknownId' }
          throw e
        }
        return { windowId: p.windowId, visible: p.visible !== false }
      },
      async focus(id) {
        c.log.push(['focus', id])
      },
      async close(id) {
        c.log.push(['close', id])
        c.openWins.delete(id)
      }
    },
    openWins: new Map(),
    state: {
      async get() {
        return { ...c.stateValues }
      },
      async set(v) {
        Object.assign(c.stateValues, v)
      }
    },
    // deliver a bus message to the manager's subscription
    emit(topic, params) {
      for (const s of c.subs) if (s.patterns.includes(topic)) s.handler(topic, params)
    },
    snapshots() {
      return c.published.filter((p) => p.topic === T.snapshot).map((p) => p.params)
    },
    lastSnapshot() {
      return c.snapshots().at(-1)
    },
    replies() {
      return c.published.filter((p) => p.topic === T.reply).map((p) => p.params)
    },
    ops(name) {
      return c.log.filter(([m]) => m === name).map(([, p]) => p)
    }
  }
  return c
}

function fakeApi({ apps = [], buttons = [], webapps, level = 'admin', conflictOnce = false, saveStatus } = {}) {
  const api = {
    revision: 3,
    apps,
    saves: [],
    async loadApps() {
      return { revision: api.revision, apps: api.apps, editLevel: 'readwrite' }
    },
    async saveApps(revision, list) {
      api.saves.push(list)
      if (saveStatus) throw new HttpError(saveStatus, { message: 'nope' })
      if (conflictOnce) {
        conflictOnce = false
        api.revision++
        api.apps = api.apps.slice(0, 1) // another device removed the rest
        throw new HttpError(409, { revision: api.revision })
      }
      if (revision !== api.revision) throw new HttpError(409, { revision: api.revision })
      api.revision++
      api.apps = list
      return { revision: api.revision }
    },
    async loadWebapps() {
      return webapps ?? api.apps.map((e) => ({ package: e.source.package, name: e.name }))
    },
    async loadButtons() {
      return buttons
    },
    async loginStatus() {
      return { status: 'loggedIn', authenticationRequired: true, userLevel: level }
    }
  }
  return api
}

async function setup(opts = {}) {
  const client = fakeClient(opts)
  const api = fakeApi(opts)
  let ids = 0
  const m = createManager({ client, api, newId: () => `new${++ids}`, setTimer: () => {} })
  await m.start()
  return { m, client, api }
}

const send = async (m, client, topic, params) => {
  client.emit(topic, { v: 1, reqId: 'r' + Math.random(), ...params })
  await m.idle()
  await m.idle()
}
const stateOf = (client, id) => client.lastSnapshot().status[id].state

test('subscribes only to its own topics and the window events', async () => {
  const { client } = await setup()
  assert.deepStrictEqual(client.subs[0].patterns, MANAGER_TOPICS)
  assert.deepStrictEqual(client.subs[1].patterns, ['window.closed', 'window.state', 'window.bounds'])
  for (const p of client.subs[0].patterns) assert.ok(p.startsWith(PFX))
})

test('every publish is scoped to the extension and namespaced', async () => {
  const { m, client } = await setup({ apps: [entry('a')] })
  await send(m, client, T.setOpen, { entryId: 'a', open: true })
  assert.ok(client.published.length > 0)
  for (const p of client.published) {
    assert.strictEqual(p.scope, 'extension')
    assert.ok(p.topic.startsWith(PFX))
    assert.strictEqual(p.params.v, 1)
  }
})

test('startup: always / remember (on, off) / never; side-panel apps never open', async () => {
  const apps = [
    entry('a', { startup: 'always' }),
    entry('b', { startup: 'remember' }),
    entry('c', { startup: 'remember' }),
    entry('d', { startup: 'never' }),
    panelEntry('p1', { startup: 'always' }),
    panelEntry('p2', { startup: 'always' })
  ]
  const { client } = await setup({ apps, openApps: { b: true, d: true } })
  assert.deepStrictEqual(
    client.ops('open').map((o) => o.restoreKey),
    ['a', 'b']
  )
  // a list saved when side-panel apps could open at startup
  assert.strictEqual(client.lastSnapshot().panelApp, null)
  assert.ok(!client.log.some(([m]) => m === 'ui.openPanel'))
  assert.deepStrictEqual(client.stateValues.openApps, { a: true, b: true })
})

test('openWindow parameters (§4.3)', async () => {
  const { client } = await setup({ apps: [entry('x'), entry('a', { startup: 'always', closeBehavior: 'hide', source: { type: 'webapp', package: '@s/k', suffix: '#/p' } })] })
  const [o] = client.ops('open')
  assert.deepStrictEqual(o, {
    panel: 'viewer',
    params: { url: '/@s/k/#/p' },
    title: 'App a',
    userClose: 'hide',
    restoreKey: 'a',
    geometry: { anchor: 'bottom-right', offset: { x: 48, y: 48 }, width: 480, height: 360 }
  })
})

test('windows.limit gives the remaining entries an error', async () => {
  const apps = [entry('a', { startup: 'always' }), entry('b', { startup: 'always' }), entry('c', { startup: 'always' })]
  const { client } = await setup({ apps, limit: 1 })
  const s = client.lastSnapshot().status
  assert.strictEqual(s.a.state, 'open')
  assert.strictEqual(s.b.state, 'error')
  assert.strictEqual(s.b.error, MESSAGES.limit)
  assert.strictEqual(s.c.error, MESSAGES.limit)
})

test('bring up / take down with unload and hide', async () => {
  const { m, client } = await setup({ apps: [entry('u'), entry('h', { closeBehavior: 'hide' })] })
  await send(m, client, T.setOpen, { entryId: 'u', open: true })
  assert.strictEqual(stateOf(client, 'u'), 'open')
  await send(m, client, T.setOpen, { entryId: 'u', open: true }) // open -> focus
  assert.strictEqual(client.ops('focus').length, 1)
  await send(m, client, T.setOpen, { entryId: 'u', open: false })
  assert.strictEqual(stateOf(client, 'u'), 'closed')
  assert.strictEqual(client.ops('close').length, 1)

  await send(m, client, T.setOpen, { entryId: 'h', open: true })
  const wid = client.ops('open').at(-1) && [...client.openWins.keys()].at(-1)
  await send(m, client, T.setOpen, { entryId: 'h', open: false })
  assert.strictEqual(stateOf(client, 'h'), 'hidden')
  assert.deepStrictEqual(client.ops('update').at(-1), { windowId: wid, visible: false })
  await send(m, client, T.setOpen, { entryId: 'h', open: true })
  assert.strictEqual(stateOf(client, 'h'), 'open')
  assert.deepStrictEqual(client.ops('update').at(-1), { windowId: wid, visible: true })
  assert.strictEqual(client.ops('open').length, 2, 'hidden window is shown, not reopened')
  const replies = client.replies()
  assert.strictEqual(replies.length, 6, 'one reply per setOpen')
  assert.ok(replies.every((r) => r.ok))
})

test('toggle: window entry open / hidden / closed; unknown ignored', async () => {
  const { m, client } = await setup({ apps: [entry('h', { closeBehavior: 'hide' })] })
  await send(m, client, T.toggle, { entryId: 'h' })
  assert.strictEqual(stateOf(client, 'h'), 'open')
  await send(m, client, T.toggle, { entryId: 'h' })
  assert.strictEqual(stateOf(client, 'h'), 'hidden')
  await send(m, client, T.toggle, { entryId: 'h' })
  assert.strictEqual(stateOf(client, 'h'), 'open')
  assert.strictEqual(client.ops('open').length, 1, 'a button never opens a second copy')
  const before = client.log.length
  await send(m, client, T.toggle, { entryId: 'nope' })
  assert.strictEqual(client.log.length, before)
  assert.strictEqual(client.replies().length, 0, 'toggle has no reply')
})

test('toggle: side-panel entry and the launcher', async () => {
  const { m, client } = await setup({ apps: [panelEntry('p')] })
  // launcher is panelApp initially -> togglePanel
  await send(m, client, T.toggle, { entryId: null })
  assert.deepStrictEqual(client.log.at(-1), ['ui.togglePanel', { panel: 'app-panel' }])
  // p is not panelApp -> show: snapshot then openPanel
  const nSnaps = client.snapshots().length
  await send(m, client, T.toggle, { entryId: 'p' })
  assert.strictEqual(client.lastSnapshot().panelApp, 'p')
  assert.ok(client.snapshots().length > nSnaps)
  assert.deepStrictEqual(client.log.at(-1), ['ui.openPanel', { panel: 'app-panel' }])
  await send(m, client, T.toggle, { entryId: 'p' })
  assert.deepStrictEqual(client.log.at(-1), ['ui.togglePanel', { panel: 'app-panel' }])
  await send(m, client, T.toggle, { entryId: null })
  assert.strictEqual(client.lastSnapshot().panelApp, null)
  assert.deepStrictEqual(client.log.at(-1), ['ui.openPanel', { panel: 'app-panel' }])
})

test('window events update status and openApps; unknown windows ignored', async () => {
  for (const reason of ['user', 'host', 'extension']) {
    const { m, client } = await setup({ apps: [entry('a', { startup: 'always' })] })
    const wid = [...client.openWins.keys()][0]
    assert.deepStrictEqual(client.stateValues.openApps, { a: true })
    m.onWindowEvent('window.state', { windowId: wid, visible: false })
    assert.strictEqual(stateOf(client, 'a'), 'hidden')
    assert.deepStrictEqual(client.stateValues.openApps, {})
    m.onWindowEvent('window.state', { windowId: wid, visible: true, collapsed: true })
    assert.strictEqual(stateOf(client, 'a'), 'open')
    m.onWindowEvent('window.closed', { windowId: wid, reason })
    assert.strictEqual(stateOf(client, 'a'), 'closed')
    assert.deepStrictEqual(client.stateValues.openApps, {})
    const n = client.published.length
    m.onWindowEvent('window.closed', { windowId: 'other', reason })
    m.onWindowEvent('window.state', { windowId: 'other', visible: false })
    assert.strictEqual(client.published.length, n)
    assert.strictEqual(client.ops('open').length, 1, 'never reopened automatically')
  }
})

test('edits: rename in place; source / close behavior reopen keeping hidden state', async () => {
  const a = entry('a', { startup: 'always', closeBehavior: 'hide' })
  const { m, client, api } = await setup({ apps: [a] })
  const w1 = [...client.openWins.keys()][0]
  await send(m, client, T.saveEntry, { entry: { ...a, name: 'Renamed' } })
  assert.deepStrictEqual(client.ops('update').at(-1), { windowId: w1, title: 'Renamed' })
  assert.strictEqual(client.ops('open').length, 1)
  assert.strictEqual(api.apps[0].name, 'Renamed')

  m.onWindowEvent('window.state', { windowId: w1, visible: false })
  await send(m, client, T.saveEntry, { entry: { ...a, name: 'Renamed', source: { type: 'url', url: 'https://x.y/' } } })
  assert.deepStrictEqual(client.ops('close'), [w1])
  const reopened = client.ops('open').at(-1)
  assert.strictEqual(reopened.params.url, 'https://x.y/')
  assert.strictEqual(reopened.visible, false)
  assert.strictEqual(stateOf(client, 'a'), 'hidden')
  assert.ok(client.replies().every((r) => r.ok))
})

test('edits: showIn changes both ways; deleting closes the window / resets panelApp', async () => {
  const { m, client } = await setup({ apps: [entry('a', { startup: 'always' }), panelEntry('p')] })
  await send(m, client, T.setOpen, { entryId: 'p', open: true })
  assert.strictEqual(client.lastSnapshot().panelApp, 'p')
  const w = [...client.openWins.keys()][0]
  await send(m, client, T.saveEntry, { entry: { ...entry('a'), showIn: 'panel' } })
  assert.deepStrictEqual(client.ops('close'), [w])
  await send(m, client, T.saveEntry, { entry: { ...panelEntry('p'), showIn: 'window' } })
  assert.strictEqual(client.lastSnapshot().panelApp, null)

  const r = await setup({ apps: [entry('a', { startup: 'always' }), panelEntry('p')], openApps: {} })
  await send(r.m, r.client, T.setOpen, { entryId: 'p', open: true })
  const w2 = [...r.client.openWins.keys()][0]
  await send(r.m, r.client, T.deleteEntry, { entryId: 'a' })
  assert.deepStrictEqual(r.client.ops('close'), [w2])
  await send(r.m, r.client, T.deleteEntry, { entryId: 'p' })
  const snap = r.client.lastSnapshot()
  assert.strictEqual(snap.panelApp, null)
  assert.deepStrictEqual(snap.entries, [])
  assert.deepStrictEqual(r.client.stateValues.openApps, {})
})

test('add assigns an id; save replies once; invalid entries are refused', async () => {
  const { m, client, api } = await setup()
  const { id, ...fresh } = entry('z')
  await send(m, client, T.saveEntry, { entry: fresh })
  assert.strictEqual(api.apps[0].id, 'new1')
  assert.deepStrictEqual(client.replies().at(-1).ok, true)
  assert.strictEqual(client.replies().at(-1).entryId, 'new1')
  await send(m, client, T.saveEntry, { entry: { ...fresh, source: { type: 'url', url: 'javascript:x' } } })
  const r = client.replies().at(-1)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error.code, 'invalid')
  assert.strictEqual(api.saves.length, 1)
})

test('needsReload follows button changes only', async () => {
  const loaded = [
    { id: 'app-a', title: 'App a', slot: 'mapToolbar', icon: 'speed', action: { type: 'publish', topic: PFX + 'toggle', params: { v: 1, entryId: 'a' }, scope: 'extension' } }
  ]
  const a = entry('a', { icon: 'speed' })
  const { m, client } = await setup({ apps: [a, entry('b')], buttons: loaded })
  assert.strictEqual(client.lastSnapshot().needsReload, false)
  await send(m, client, T.saveEntry, { entry: { ...a, startup: 'always' } })
  assert.strictEqual(client.lastSnapshot().needsReload, false, 'non-button change')
  for (const change of [{ icon: 'waves' }, { name: 'New name' }, { icon: undefined }]) {
    await send(m, client, T.saveEntry, { entry: { ...a, ...change } })
    const snap = client.lastSnapshot()
    assert.strictEqual(snap.needsReload, true, JSON.stringify(change))
    assert.strictEqual(snap.status.a.needsReload, true)
  }
  await send(m, client, T.saveEntry, { entry: { ...entry('b'), icon: 'apps' } })
  assert.strictEqual(client.lastSnapshot().status.b.needsReload, true, 'added button')
  await send(m, client, T.saveEntry, { entry: { ...entry('b') } })
  await send(m, client, T.saveEntry, { entry: a })
  assert.strictEqual(client.lastSnapshot().needsReload, false, 'back in line with the loaded buttons')
})

test('409: reloads, reconciles and replies with an error', async () => {
  const a = entry('a', { startup: 'always' })
  const b = entry('b', { startup: 'always' })
  const { m, client, api } = await setup({ apps: [a, b], conflictOnce: true })
  const wb = [...client.openWins.keys()][1]
  await send(m, client, T.saveEntry, { entry: { ...a, name: 'x' } })
  const r = client.replies().at(-1)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.error.code, 'conflict')
  // the server now holds only `a`: b's window is closed
  assert.ok(client.ops('close').includes(wb))
  assert.deepStrictEqual(client.lastSnapshot().entries.map((e) => e.id), ['a'])
  assert.strictEqual(api.apps[0].name, 'App a', 'nothing merged')
})

test('403 on save turns editing off', async () => {
  const { m, client } = await setup({ apps: [entry('a')], saveStatus: 403 })
  assert.strictEqual(client.lastSnapshot().canEdit, true)
  await send(m, client, T.deleteEntry, { entryId: 'a' })
  assert.strictEqual(client.replies().at(-1).error.code, 'forbidden')
  assert.strictEqual(client.lastSnapshot().canEdit, false)
})

test('canEdit from loginStatus', async () => {
  assert.strictEqual((await setup({ level: 'readwrite' })).client.lastSnapshot().canEdit, true)
  assert.strictEqual((await setup({ level: 'readonly' })).client.lastSnapshot().canEdit, false)
})

test('an uninstalled webapp is not opened or shown', async () => {
  const { m, client } = await setup({ apps: [entry('a'), panelEntry('p')], webapps: [] })
  await send(m, client, T.setOpen, { entryId: 'a', open: true })
  assert.strictEqual(client.ops('open').length, 0)
  assert.strictEqual(client.lastSnapshot().status.a.error, MESSAGES.notInstalled)
  assert.strictEqual(client.replies().at(-1).ok, false)
  await send(m, client, T.setOpen, { entryId: 'p', open: true })
  assert.strictEqual(client.lastSnapshot().panelApp, null)
  assert.strictEqual(client.lastSnapshot().status.p.error, MESSAGES.notInstalled)
  assert.ok(!client.log.some(([x]) => x === 'ui.openPanel'))
})

test('messages with another version are ignored', async () => {
  const { m, client } = await setup({ apps: [entry('a')] })
  const n = client.published.length
  client.emit(T.setOpen, { v: 2, reqId: 'x', entryId: 'a', open: true })
  client.emit(T.hello, {})
  await m.idle()
  assert.strictEqual(client.published.length, n)
  client.emit(T.hello, { v: 1 })
  await m.idle()
  assert.strictEqual(client.published.length, n + 1)
})

test('snapshot carries side-panel URLs and webapps without the host', async () => {
  const client = fakeClient()
  const api = fakeApi({ apps: [panelEntry('p', { source: { type: 'webapp', package: 'kip', suffix: '#/x' } }), entry('w')], webapps: [{ package: 'kip', name: 'KIP' }, { package: 'app-w', name: 'W' }, { package: '@signalk/freeboard-sk', name: 'FSK' }] })
  const m = createManager({ client, api, hostName: 'freeboard-sk', setTimer: () => {} })
  await m.start()
  const s = client.lastSnapshot()
  assert.deepStrictEqual(s.urls, { p: '/kip/#/x' })
  assert.deepStrictEqual(s.webapps.map((w) => w.package), ['kip', 'app-w'])
})

test('a list load failure sets a problem and retries', async () => {
  const client = fakeClient()
  const api = fakeApi({ apps: [entry('a', { startup: 'always' })] })
  let fail = true
  const real = api.loadApps
  api.loadApps = async () => {
    if (fail) throw new Error('down')
    return real()
  }
  const timers = []
  const m = createManager({ client, api, setTimer: (fn, ms) => timers.push([fn, ms]) })
  await m.start()
  assert.strictEqual(client.lastSnapshot().problem, MESSAGES.listLoad)
  assert.strictEqual(timers[0][1], 5000)
  fail = false
  timers[0][0]()
  await m.idle()
  await m.idle()
  assert.strictEqual(client.lastSnapshot().problem, undefined)
  assert.strictEqual(client.ops('open').length, 1, 'startup applied after the retry')
})

test('an embedded chartplotter applies no startup options and keeps openApps untouched', async () => {
  const client = fakeClient({ openApps: { a: true } })
  const api = fakeApi({ apps: [entry('a', { startup: 'remember' }), entry('b', { startup: 'always' }), panelEntry('p', { startup: 'always' })] })
  const m = createManager({ client, api, embedded: true, setTimer: () => {} })
  await m.start()
  assert.strictEqual(client.ops('open').length, 0)
  assert.ok(!client.log.some(([x]) => x === 'ui.openPanel'))
  client.emit(T.setOpen, { v: 1, reqId: 'r', entryId: 'b', open: true })
  await m.idle()
  assert.strictEqual(client.ops('open').length, 1, 'the user can still open apps')
  assert.deepStrictEqual(client.stateValues.openApps, { a: true })
})

test('showing a hidden window: reopen only when the host no longer has it', async () => {
  const { m, client } = await setup({ apps: [entry('h', { closeBehavior: 'hide' })] })
  await send(m, client, T.setOpen, { entryId: 'h', open: true })
  await send(m, client, T.setOpen, { entryId: 'h', open: false })
  // the host reclaimed it
  client.openWins.clear()
  await send(m, client, T.setOpen, { entryId: 'h', open: true })
  assert.strictEqual(client.ops('open').length, 2)
  assert.strictEqual(stateOf(client, 'h'), 'open')

  await send(m, client, T.setOpen, { entryId: 'h', open: false })
  client.failUpdate = 'call timed out'
  await send(m, client, T.setOpen, { entryId: 'h', open: true })
  assert.strictEqual(client.ops('open').length, 2, 'no second window while the first may still exist')
  assert.strictEqual(stateOf(client, 'h'), 'hidden')
  assert.strictEqual(client.lastSnapshot().status.h.error, 'call timed out')
  assert.strictEqual(client.replies().at(-1).ok, false)
})

test('hello is answered after startup has loaded the list', async () => {
  const client = fakeClient()
  const api = fakeApi({ apps: [entry('a')] })
  let release
  const gate = new Promise((r) => (release = r))
  const realLoad = api.loadApps
  api.loadApps = async () => {
    await gate
    return realLoad()
  }
  const m = createManager({ client, api, setTimer: () => {} })
  const started = m.start()
  await new Promise((r) => setTimeout(r, 0))
  client.emit(T.hello, { v: 1 })
  await new Promise((r) => setTimeout(r, 0))
  assert.strictEqual(client.snapshots().length, 0, 'no empty snapshot while loading')
  release()
  await started
  await m.idle()
  assert.ok(client.snapshots().length >= 1)
  assert.ok(client.snapshots().every((snap) => snap.entries.length === 1))
})
