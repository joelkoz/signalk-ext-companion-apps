// The built-in static handler for public/ (§7.1).

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { serveStatic } = require('../plugin/static')

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-apps-static-'))
  const root = path.join(dir, 'public')
  fs.mkdirSync(path.join(root, 'js'), { recursive: true })
  fs.writeFileSync(path.join(root, 'sidepanel.html'), '<!doctype html>')
  fs.writeFileSync(path.join(root, 'js', 'viewer.js'), 'x()')
  fs.writeFileSync(path.join(dir, 'secret.html'), 'nope')
  fs.writeFileSync(path.join(root, 'notes.txt'), 'unknown type')
  return serveStatic(root)
}

function request(handler, reqPath, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve) => {
    const chunks = []
    const res = new (require('stream').Writable)({
      write(c, _e, cb) {
        chunks.push(c)
        cb()
      }
    })
    res.headers = {}
    res.statusCode = 200
    res.setHeader = (k, v) => (res.headers[k.toLowerCase()] = v)
    const done = () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })
    res.end = (c) => {
      if (c) chunks.push(Buffer.from(c))
      done()
    }
    res.on('finish', done)
    const next = () => resolve({ status: 'next' })
    handler({ method, path: reqPath, headers }, res, next)
  })
}

test('serves files under the root with their type', async () => {
  const h = fixture()
  const page = await request(h, '/sidepanel.html')
  assert.strictEqual(page.status, 200)
  assert.strictEqual(page.headers['content-type'], 'text/html; charset=utf-8')
  assert.strictEqual(page.body, '<!doctype html>')
  assert.strictEqual(page.headers['cache-control'], 'no-cache')
  const js = await request(h, '/js/viewer.js')
  assert.strictEqual(js.headers['content-type'], 'text/javascript; charset=utf-8')
})

test('never serves outside the root or unknown types', async () => {
  const h = fixture()
  for (const p of ['/../secret.html', '/%2e%2e/secret.html', '/js/../../secret.html', '/notes.txt', '/missing.html', '/js', '/%00.html', '/%E0%A4%A.html']) {
    assert.strictEqual((await request(h, p)).status, 404, p)
  }
})

test('HEAD, ETag revalidation, and other methods passed on', async () => {
  const h = fixture()
  const first = await request(h, '/sidepanel.html')
  const again = await request(h, '/sidepanel.html', { headers: { 'if-none-match': first.headers.etag } })
  assert.strictEqual(again.status, 304)
  const head = await request(h, '/sidepanel.html', { method: 'HEAD' })
  assert.strictEqual(head.status, 200)
  assert.strictEqual(head.body, '')
  assert.strictEqual((await request(h, '/sidepanel.html', { method: 'POST' })).status, 'next')
})
