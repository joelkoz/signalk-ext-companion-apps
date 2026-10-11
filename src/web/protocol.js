// Bus topics and helpers shared by the window manager and the side panel
// (REQUIREMENTS.md §5). Every message is published with scope 'extension'
// and carries `v: 1`.

export const PREFIX = 'signalk-ext-companion-apps.'
export const VERSION = 1
export const SCOPE = 'extension'

export const T = {
  hello: `${PREFIX}hello`,
  setOpen: `${PREFIX}setOpen`,
  toggle: `${PREFIX}toggle`,
  setTitleBar: `${PREFIX}setTitleBar`,
  saveEntry: `${PREFIX}saveEntry`,
  deleteEntry: `${PREFIX}deleteEntry`,
  reload: `${PREFIX}reload`,
  snapshot: `${PREFIX}snapshot`,
  reply: `${PREFIX}reply`
}

/** Topics the window manager handles. */
export const MANAGER_TOPICS = [T.hello, T.setOpen, T.toggle, T.setTitleBar, T.saveEntry, T.deleteEntry, T.reload]
/** Topics the side panel handles. */
export const PANEL_TOPICS = [T.snapshot, T.reply]

export const PANEL_ID = 'app-panel'
export const VIEWER_ID = 'viewer'

/**
 * A random id from crypto.getRandomValues. Not crypto.randomUUID: that
 * exists only in secure contexts, and Signal K is often served over plain
 * http on a LAN address (§4.6).
 */
export function randomId(length = 12, cryptoImpl = globalThis.crypto) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(length)
  cryptoImpl.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}

/** Whether a received params object is a v1 message. */
export function isV1(params) {
  return !!params && typeof params === 'object' && params.v === VERSION
}
