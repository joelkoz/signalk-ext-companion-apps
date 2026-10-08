// Side-panel frame manager (REQUIREMENTS.md §4.9, §9.2): keeps one child
// iframe per loaded side-panel app and shows the current one, or the
// launcher view. Pure over a minimal DOM (createElement, appendChild,
// remove, `hidden`), so tests run it on a fake.
//
// Frames are hidden, never moved: moving or re-inserting an iframe reloads
// it. The CSS keeps a hidden frame laid out (visibility, not display) so
// apps that measure themselves keep their size.

import validate from '../../plugin/validate.js'

const { isAllowedUrl } = validate

export function createFrames({ container, launcher, doc = document, hasVisibility = false }) {
  const frames = new Map() // entryId -> iframe
  const loaded = new Map() // entryId -> the URL its frame was given
  let entries = new Map() // entryId -> entry (side-panel entries only)
  let urls = {}
  let current = null
  let visible = true

  const keep = (id) => entries.get(id)?.closeBehavior === 'hide'

  function drop(id) {
    const f = frames.get(id)
    if (!f) return
    f.remove()
    frames.delete(id)
    loaded.delete(id)
  }

  function ensure(id) {
    let f = frames.get(id)
    const url = urls[id]
    if (!isAllowedUrl(url)) {
      drop(id)
      return null
    }
    if (!f) {
      f = doc.createElement('iframe')
      f.className = 'app-frame'
      f.title = entries.get(id)?.name ?? 'App'
      f.hidden = true
      f.src = url
      container.appendChild(f)
      frames.set(id, f)
      loaded.set(id, url)
    }
    return f
  }

  function render() {
    const showing = current !== null && (!hasVisibility || visible) ? ensure(current) : null
    for (const [id, f] of frames) f.hidden = !(id === current && showing)
    launcher.hidden = current !== null && showing !== null
    // A current app whose frame is unloaded while the drawer is hidden keeps
    // the launcher hidden too: nothing is on screen then.
    if (current !== null && hasVisibility && !visible) launcher.hidden = true
  }

  /** Converge on a window-manager snapshot. */
  function applySnapshot(snap) {
    entries = new Map((snap.entries ?? []).filter((e) => e.showIn === 'panel').map((e) => [e.id, e]))
    urls = snap.urls ?? {}
    for (const [id, f] of [...frames]) {
      if (!entries.has(id) || !isAllowedUrl(urls[id])) drop(id)
      else {
        f.title = entries.get(id).name
        if (loaded.get(id) === urls[id]) continue
        f.src = urls[id]
        loaded.set(id, urls[id])
      }
    }
    current = snap.panelApp !== null && entries.has(snap.panelApp) ? snap.panelApp : null
    // Only the current app and Hide apps stay loaded: this drops the app just
    // switched away from, and one whose close behavior became Unload.
    for (const id of [...frames.keys()]) if (id !== current && !keep(id)) drop(id)
    render()
  }

  /** `panels.state` visibility of app-panel (only when the host reports it). */
  function setVisible(v) {
    if (!hasVisibility || v === visible) return
    visible = v
    if (!visible && current !== null && !keep(current)) drop(current)
    render()
  }

  return {
    applySnapshot,
    setVisible,
    get current() {
      return current
    },
    get frames() {
      return frames
    }
  }
}
