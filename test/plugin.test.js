// Plugin contract: manifest provider and routes (§2, §7).

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const entry = (id, extra = {}) => ({
  id,
  name: `App ${id}`,
  source: { type: 'webapp', package: '@mxtommy/kip' },
  showIn: 'window',
  closeBehavior: 'unload',
  startup: 'remember',
  ...extra
})

function fakeApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-apps-'))
  const calls = { providers: [], errors: [] }
  return {
    dir,
    calls,
    debug: () => {},
    error: (m) => calls.errors.push(m),
    getDataDirPath: () => dir,
    registerResourceProvider: (p) => calls.providers.push(p)
  }
}

function fakeRouter({ withAccess }) {
  const routes = {}
  const reg = (level) => (method) => (p, h) => {
    routes[`${method} ${p}`] = { handler: h, level }
    return registrar
  }
  const registrar = {}
  const router = {
    get: (p, h) => reg('admin')('GET')(p, h),
    put: (p, h) => reg('admin')('PUT')(p, h)
  }
  if (withAccess) {
    router.access = (level) => ({ get: reg(level)('GET'), put: reg(level)('PUT') })
  }
  return { router, routes }
}

function call(route, body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) {
        this.statusCode = c
        return this
      },
      json(b) {
        resolve({ status: this.statusCode, body: b })
      }
    }
    route.handler({ body }, res)
  })
}

function setup(opts = { withAccess: true }) {
  const app = fakeApp()
  const plugin = require('../plugin/index.js')(app)
  const { router, routes } = fakeRouter(opts)
  plugin.registerWithRouter(router)
  plugin.start({})
  return { app, plugin, routes, provider: app.calls.providers[0] }
}

test('fixed manifest (§2)', async () => {
  const { provider } = setup()
  assert.strictEqual(provider.type, 'plotterExtensions')
  const m = (await provider.methods.listResources({}))['signalk-ext-companion-apps']
  assert.strictEqual(m.apiVersion, '1')
  assert.deepStrictEqual(m.requires, ['windows', 'panels.iframe', 'buttons', 'background.iframe', 'events.publish'])
  assert.deepStrictEqual(m.optional, ['panels.state'])
  assert.deepStrictEqual(
    m.panels.map((p) => [p.id, p.lifecycle]),
    [
      ['app-panel', 'keepAlive'],
      ['viewer', undefined]
    ]
  )
  assert.strictEqual(m.background[0].id, 'window-manager')
  assert.strictEqual(m.buttons.length, 1)
  assert.deepStrictEqual(m.buttons[0].action, {
    type: 'publish',
    topic: 'signalk-ext-companion-apps.toggle',
    params: { v: 1, entryId: null },
    scope: 'extension'
  })
  for (const u of [...m.panels.map((p) => p.url), m.background[0].url]) {
    assert.ok(u.startsWith('/plotterext/signalk-ext-companion-apps/'), u)
  }
})

test('a PUT changes the generated buttons of the next manifest (§2.1)', async () => {
  const { provider, routes } = setup()
  const apps = [entry('a', { icon: 'speed' }), entry('b'), entry('c', { icon: 'waves', showIn: 'panel', startup: 'never' })]
  const r = await call(routes['PUT /apps'], { revision: 0, apps })
  assert.deepStrictEqual(r, { status: 200, body: { revision: 1 } })
  const m = await provider.methods.getResource('signalk-ext-companion-apps')
  assert.deepStrictEqual(
    m.buttons.map((b) => [b.id, b.icon, b.title]),
    [
      ['companion-apps', 'web', 'Companion Apps'],
      ['app-a', 'speed', 'App a'],
      ['app-c', 'waves', 'App c']
    ]
  )
  for (const b of m.buttons) {
    assert.strictEqual(b.action.type, 'publish')
    assert.strictEqual(b.action.scope, 'extension')
    assert.strictEqual(b.slot, 'mapToolbar')
  }
  assert.deepStrictEqual(m.buttons[1].action.params, { v: 1, entryId: 'a' })
})

test('provider is read-only and empty while stopped', async () => {
  const { provider, plugin } = setup()
  await assert.rejects(() => provider.methods.getResource('nope'))
  await assert.rejects(() => provider.methods.setResource('x', {}))
  await assert.rejects(() => provider.methods.deleteResource('x'))
  plugin.stop()
  assert.deepStrictEqual(await provider.methods.listResources({}), {})
  await assert.rejects(() => provider.methods.getResource('signalk-ext-companion-apps'))
})

test('routes: GET, PUT 200 / 400 / 409 (§7.2)', async () => {
  const { routes } = setup()
  assert.deepStrictEqual((await call(routes['GET /apps'])).body, { revision: 0, apps: [], editLevel: 'readwrite' })
  assert.strictEqual((await call(routes['PUT /apps'], { revision: 0, apps: [entry('a')] })).status, 200)
  const stale = await call(routes['PUT /apps'], { revision: 0, apps: [] })
  assert.deepStrictEqual(stale, { status: 409, body: { revision: 1 } })
  const bad = await call(routes['PUT /apps'], { revision: 1, apps: [{ ...entry('a'), source: { type: 'url', url: 'javascript:x' } }] })
  assert.strictEqual(bad.status, 400)
  assert.match(bad.body.message, /URL/)
  assert.strictEqual((await call(routes['PUT /apps'], { apps: [] })).status, 400)
  const got = await call(routes['GET /apps'])
  assert.strictEqual(got.body.revision, 1)
  assert.strictEqual(got.body.apps.length, 1)
})

test('router.access is used when present, plain admin routes otherwise (§7.3)', async () => {
  const withAccess = setup({ withAccess: true })
  assert.strictEqual(withAccess.routes['GET /apps'].level, 'readonly')
  assert.strictEqual(withAccess.routes['PUT /apps'].level, 'readwrite')
  const without = setup({ withAccess: false })
  assert.strictEqual(without.routes['GET /apps'].level, 'admin')
  assert.strictEqual(without.routes['PUT /apps'].level, 'admin')
  assert.strictEqual((await call(without.routes['GET /apps'])).body.editLevel, 'admin')
})

test('package metadata (§11)', () => {
  const pkg = require('../package.json')
  assert.strictEqual(pkg.main, 'plugin/index.js')
  assert.ok(pkg.keywords.includes('signalk-node-server-plugin'))
  assert.ok(!pkg.keywords.includes('signalk-webapp'))
  assert.strictEqual(pkg['signalk-plugin-enabled-by-default'], true)
  assert.strictEqual(pkg.dependencies, undefined)
  for (const [, range] of Object.entries(pkg.devDependencies)) assert.ok(!range.startsWith('file:'))
})
