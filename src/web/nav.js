// Side-panel navigation bar (REQUIREMENTS.md §9.3): which side-panel app the
// previous / next arrows switch to. Pure, so tests need no DOM.

/** Ids of the side-panel entries, in list order. */
export function panelAppIds(entries) {
  return (entries ?? []).filter((e) => e.showIn === 'panel').map((e) => e.id)
}

/**
 * Where the arrow in direction `dir` (+1 next, -1 previous) switches to: the
 * App Manager (`null`) comes first in the cycle, then the side-panel apps in
 * list order, wrapping around. Returns `undefined` when there is nowhere else
 * to go (no side-panel apps).
 */
export function stepApp(ids, current, dir) {
  if (ids.length === 0) return undefined
  const cycle = [null, ...ids]
  const i = Math.max(0, cycle.indexOf(current))
  return cycle[(i + dir + cycle.length) % cycle.length]
}
