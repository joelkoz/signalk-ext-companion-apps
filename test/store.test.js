const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createStore, StaleRevisionError } = require('../plugin/store')
const { ValidationError } = require('../plugin/validate')

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'companion-apps-'))
const entry = (id = 'a1') => ({
  id,
  name: 'KIP',
  source: { type: 'webapp', package: '@mxtommy/kip' },
  showIn: 'window',
  closeBehavior: 'unload',
  startup: 'remember'
})

test('a missing file is an empty list at revision 0', () => {
  const s = createStore(tmpDir())
  assert.deepStrictEqual(s.load(), { revision: 0, apps: [] })
})

test('save round-trips and increments the revision', () => {
  const dir = tmpDir()
  const s = createStore(dir)
  s.load()
  assert.strictEqual(s.save(0, [entry()]).revision, 1)
  assert.strictEqual(s.save(1, [entry(), entry('b2')]).revision, 2)
  const again = createStore(dir)
  const loaded = again.load()
  assert.strictEqual(loaded.revision, 2)
  assert.strictEqual(loaded.apps.length, 2)
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'apps.json'), 'utf8'))
  assert.strictEqual(raw.version, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'apps.json.tmp')))
})

test('a stale revision is rejected; an invalid list is rejected without writing', () => {
  const dir = tmpDir()
  const s = createStore(dir)
  s.load()
  s.save(0, [entry()])
  assert.throws(() => s.save(0, []), StaleRevisionError)
  assert.throws(() => s.save(1, [{ ...entry(), showIn: 'x' }]), ValidationError)
  assert.strictEqual(createStore(dir).load().apps.length, 1)
})

test('atomic write: a failed write leaves the old file intact', () => {
  const dir = tmpDir()
  const s0 = createStore(dir)
  s0.load()
  s0.save(0, [entry()])
  const failing = {
    ...fs,
    writeFileSync: (p, ...rest) => {
      if (p.endsWith('.tmp')) {
        fs.writeFileSync(p, '{"partial')
        throw new Error('disk full')
      }
      return fs.writeFileSync(p, ...rest)
    }
  }
  const s = createStore(dir, { fsImpl: failing })
  s.load()
  assert.throws(() => s.save(1, [entry(), entry('b2')]), /disk full/)
  assert.strictEqual(createStore(dir).load().apps.length, 1)
  assert.ok(!fs.existsSync(path.join(dir, 'apps.json.tmp')))
  assert.strictEqual(s.get().revision, 1)
})

test('a corrupt file is moved aside and logged', () => {
  for (const body of ['{not json', JSON.stringify({ version: 1, revision: 1, apps: [{ id: 'bad' }] })]) {
    const dir = tmpDir()
    fs.writeFileSync(path.join(dir, 'apps.json'), body)
    const errors = []
    const s = createStore(dir, { error: (m) => errors.push(m) })
    assert.deepStrictEqual(s.load(), { revision: 0, apps: [] })
    assert.strictEqual(errors.length, 1)
    const aside = fs.readdirSync(dir).filter((f) => f.startsWith('apps.json.corrupt-'))
    assert.strictEqual(aside.length, 1)
    assert.strictEqual(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), body)
  }
})
