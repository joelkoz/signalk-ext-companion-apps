// Side-panel navigation bar: where the arrows switch to (§9.3).

import { test } from 'node:test'
import assert from 'node:assert'
import { panelAppIds, stepApp } from '../src/web/nav.js'

test('panelAppIds keeps side-panel entries in list order', () => {
  const entries = [
    { id: 'w', showIn: 'window' },
    { id: 'a', showIn: 'panel' },
    { id: 'b', showIn: 'panel' }
  ]
  assert.deepStrictEqual(panelAppIds(entries), ['a', 'b'])
  assert.deepStrictEqual(panelAppIds(undefined), [])
})

test('the cycle is App Manager, then the apps in order, wrapping around', () => {
  const ids = ['a', 'b']
  assert.strictEqual(stepApp(ids, null, +1), 'a')
  assert.strictEqual(stepApp(ids, 'a', +1), 'b')
  assert.strictEqual(stepApp(ids, 'b', +1), null)
  assert.strictEqual(stepApp(ids, null, -1), 'b')
  assert.strictEqual(stepApp(ids, 'b', -1), 'a')
  assert.strictEqual(stepApp(ids, 'a', -1), null)
})

test('a single app alternates with the App Manager', () => {
  assert.strictEqual(stepApp(['a'], 'a', +1), null)
  assert.strictEqual(stepApp(['a'], 'a', -1), null)
  assert.strictEqual(stepApp(['a'], null, +1), 'a')
})

test('no side-panel apps: nowhere to go', () => {
  assert.strictEqual(stepApp([], null, +1), undefined)
  assert.strictEqual(stepApp([], null, -1), undefined)
})

test('an unknown current entry counts as the App Manager', () => {
  assert.strictEqual(stepApp(['a', 'b'], 'gone', +1), 'a')
})
