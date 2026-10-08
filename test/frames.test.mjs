// Side-panel frame manager (§4.9, §9.2) over a fake DOM; viewer; protocol.

import { test } from 'node:test'
import assert from 'node:assert'
import { createFrames } from '../src/web/frames.js'
import { renderViewer } from '../src/web/viewer.js'
import { randomId } from '../src/web/protocol.js'

function fakeDoc() {
  const doc = {
    created: [],
    createElement(tag) {
      const el = {
        tag,
        hidden: false,
        removed: false,
        srcSets: [],
        set src(v) {
          this._src = v
          this.srcSets.push(v)
        },
        get src() {
          return this._src
        },
        remove() {
          this.removed = true
          container.children = container.children.filter((c) => c !== this)
        }
      }
      doc.created.push(el)
      return el
    }
  }
  const container = {
    children: [],
    appendChild(el) {
      this.children.push(el)
    }
  }
  return { doc, container, launcher: { hidden: false } }
}

const panel = (id, closeBehavior = 'unload') => ({ id, name: id, showIn: 'panel', closeBehavior })
const snap = (panelApp, entries, urls) => ({
  panelApp,
  entries,
  urls: urls ?? Object.fromEntries(entries.map((e) => [e.id, `/${e.id}/`]))
})

function setup(hasVisibility = false) {
  const { doc, container, launcher } = fakeDoc()
  const f = createFrames({ container, launcher, doc, hasVisibility })
  const frameOf = (id) => f.frames.get(id)
  return { f, doc, container, launcher, frameOf }
}

test('null shows the launcher; an entry creates and shows its frame', () => {
  const { f, container, launcher, frameOf } = setup()
  const entries = [panel('kip', 'hide'), panel('ip')]
  f.applySnapshot(snap(null, entries))
  assert.strictEqual(launcher.hidden, false)
  assert.strictEqual(container.children.length, 0)
  f.applySnapshot(snap('kip', entries))
  assert.strictEqual(launcher.hidden, true)
  assert.strictEqual(frameOf('kip').src, '/kip/')
  assert.strictEqual(frameOf('kip').hidden, false)
})

test('switching keeps Hide frames and drops Unload frames, including to the launcher', () => {
  const { f, frameOf } = setup()
  const entries = [panel('kip', 'hide'), panel('ip')]
  f.applySnapshot(snap('kip', entries))
  const kip = frameOf('kip')
  f.applySnapshot(snap('ip', entries))
  assert.strictEqual(kip.removed, false)
  assert.strictEqual(kip.hidden, true)
  const ip = frameOf('ip')
  f.applySnapshot(snap(null, entries))
  assert.strictEqual(ip.removed, true, 'Unload frame dropped')
  f.applySnapshot(snap('kip', entries))
  assert.strictEqual(frameOf('kip'), kip, 'Hide frame reused, not reloaded')
  assert.deepStrictEqual(kip.srcSets, ['/kip/'])
  f.applySnapshot(snap('ip', entries))
  assert.notStrictEqual(frameOf('ip'), ip, 'Unload app reloads when shown again')
})

test('reloads a frame whose URL changed; removes deleted and no-longer-panel entries', () => {
  const { f, frameOf } = setup()
  const entries = [panel('kip', 'hide'), panel('x', 'hide')]
  f.applySnapshot(snap('x', entries))
  f.applySnapshot(snap('kip', entries))
  const x = frameOf('x')
  f.applySnapshot(snap('kip', entries, { kip: '/kip/#/2', x: '/x/' }))
  assert.deepStrictEqual(frameOf('kip').srcSets, ['/kip/', '/kip/#/2'])
  f.applySnapshot(snap('kip', [panel('kip', 'hide')]))
  assert.strictEqual(x.removed, true)
  // an entry that became Unload while not current is dropped
  f.applySnapshot(snap('x', entries))
  f.applySnapshot(snap('kip', [panel('kip', 'hide'), panel('x', 'hide')]))
  const x2 = frameOf('x')
  f.applySnapshot(snap('kip', [panel('kip', 'hide'), panel('x', 'unload')]))
  assert.strictEqual(x2.removed, true)
})

test('with panel visibility: hide drops a current Unload frame, show recreates it; Hide frames stay', () => {
  const { f, frameOf } = setup(true)
  const entries = [panel('kip', 'hide'), panel('ip')]
  f.applySnapshot(snap('ip', entries))
  const ip = frameOf('ip')
  f.setVisible(false)
  assert.strictEqual(ip.removed, true)
  f.setVisible(true)
  assert.ok(frameOf('ip') && frameOf('ip') !== ip)
  f.applySnapshot(snap('kip', entries))
  const kip = frameOf('kip')
  f.setVisible(false)
  assert.strictEqual(kip.removed, false)
  f.setVisible(true)
  assert.strictEqual(frameOf('kip'), kip)
})

test('without panel visibility the current frame is never dropped', () => {
  const { f, frameOf } = setup(false)
  f.applySnapshot(snap('ip', [panel('ip')]))
  const ip = frameOf('ip')
  f.setVisible(false)
  assert.strictEqual(ip.removed, false)
  assert.strictEqual(ip.hidden, false)
})

test('invalid URLs never reach src', () => {
  const { f, doc, launcher } = setup()
  for (const url of ['javascript:alert(1)', '//evil.com/', 'data:text/html,x', undefined]) {
    f.applySnapshot(snap('bad', [panel('bad')], { bad: url }))
    assert.ok(!doc.created.some((el) => el.srcSets.length > 0), String(url))
    assert.strictEqual(launcher.hidden, false)
  }
})

test('viewer: uses the URL; invalid URLs never reach src', () => {
  const { doc } = fakeDoc()
  const root = {
    kids: [],
    set textContent(_) {
      this.kids = []
    },
    appendChild(el) {
      this.kids.push(el)
    }
  }
  const frame = renderViewer(root, '/@mxtommy/kip/', doc)
  assert.strictEqual(frame.src, '/@mxtommy/kip/')
  for (const bad of ['javascript:alert(1)', '//x.com', null]) {
    assert.strictEqual(renderViewer(root, bad, doc), null)
    assert.strictEqual(root.kids[0].tag, 'p')
  }
})

test('ids come from getRandomValues, not randomUUID', () => {
  let called = 0
  const id = randomId(12, {
    getRandomValues: (a) => {
      called++
      return a.fill(7)
    },
    randomUUID: () => assert.fail('randomUUID used')
  })
  assert.strictEqual(called, 1)
  assert.match(id, /^[a-z0-9]{12}$/)
})
