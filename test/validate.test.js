const { test } = require('node:test')
const assert = require('node:assert')
const v = require('../plugin/validate')

const base = () => ({
  id: 'abc123',
  name: 'KIP',
  source: { type: 'webapp', package: '@mxtommy/kip' },
  showIn: 'window',
  closeBehavior: 'unload',
  startup: 'remember'
})

test('URL rules (§6)', () => {
  for (const ok of ['https://example.com/', 'http://10.0.0.1:3000/x?y=1#z', '/@mxtommy/kip/', '/']) {
    assert.ok(v.isAllowedUrl(ok), ok)
  }
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,hi',
    'blob:https://x/1',
    'file:///etc/passwd',
    '//evil.com/',
    '/\\evil.com',
    'relative/path',
    'ftp://x.com/',
    '',
    null,
    'https://x.com/' + 'a'.repeat(2048),
    '/with space'
  ]) {
    assert.ok(!v.isAllowedUrl(bad), String(bad))
  }
})

test('resolveUrl keeps the scope and appends the suffix (§3.1)', () => {
  assert.strictEqual(v.resolveUrl({ type: 'webapp', package: '@mxtommy/kip', suffix: '#/page/1' }), '/@mxtommy/kip/#/page/1')
  assert.strictEqual(v.resolveUrl({ type: 'webapp', package: 'signalk-x' }), '/signalk-x/')
  assert.strictEqual(v.resolveUrl({ type: 'url', url: 'https://a.b/' }), 'https://a.b/')
  assert.strictEqual(v.resolveUrl({ type: 'url', url: 'javascript:x' }), null)
  assert.strictEqual(v.resolveUrl({ type: 'webapp', package: '../etc' }), null)
})

test('suffix rules', () => {
  assert.ok(v.isValidSuffix('#/page/1'))
  assert.ok(v.isValidSuffix('?a=b'))
  for (const bad of ['/abs', 'http://x', 'a b', 'x'.repeat(513)]) assert.ok(!v.isValidSuffix(bad), bad)
})

test('cleanEntry accepts a valid entry and drops unknown fields', () => {
  const e = v.cleanEntry({ ...base(), extra: 1, name: '  KIP  ', icon: 'speed' })
  assert.deepStrictEqual(e, { ...base(), icon: 'speed' })
})

test('cleanEntry field rules (§3)', () => {
  const bad = [
    { id: 'has space' },
    { id: 'x'.repeat(65) },
    { name: '   ' },
    { name: 'x'.repeat(81) },
    { source: { type: 'webapp', package: 'Bad Name' } },
    { source: { type: 'webapp', package: 'ok', suffix: '/abs' } },
    { source: { type: 'url', url: 'javascript:alert(1)' } },
    { source: { type: 'other' } },
    { showIn: 'tab' },
    { closeBehavior: 'kill' },
    { startup: 'sometimes' },
    { icon: 'Speed' },
    { icon: 'custom:flag' },
    { icon: 'x'.repeat(41) }
  ]
  for (const patch of bad) {
    assert.throws(() => v.cleanEntry({ ...base(), ...patch }), v.ValidationError, JSON.stringify(patch))
  }
  // side-panel apps never open at startup, whatever was saved
  for (const startup of ['always', 'remember', 'never', undefined]) {
    assert.strictEqual(v.cleanEntry({ ...base(), showIn: 'panel', startup }).startup, 'never')
  }
  assert.throws(() => v.cleanEntry({ ...base(), id: undefined }), v.ValidationError)
  assert.ok(!('id' in v.cleanEntry({ ...base(), id: undefined }, { requireId: false })))
})

test('cleanList: unique ids and the 50-entry cap', () => {
  assert.throws(() => v.cleanList([base(), base()]), /Duplicate/)
  const many = Array.from({ length: 51 }, (_, i) => ({ ...base(), id: `id${i}` }))
  assert.throws(() => v.cleanList(many), /At most 50/)
  assert.strictEqual(v.cleanList(many.slice(0, 50)).length, 50)
  assert.throws(() => v.cleanList({}), v.ValidationError)
})
