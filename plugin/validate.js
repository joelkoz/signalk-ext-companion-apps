// App-entry and URL validation (REQUIREMENTS.md §3, §3.1, §6).
//
// Shared by the server plugin (PUT /apps) and, bundled by esbuild, by the
// browser contexts (window manager, side panel, viewer). Keep it free of Node
// APIs.

const MAX_ENTRIES = 50
const MAX_URL_LENGTH = 2048
const MAX_SUFFIX_LENGTH = 512
const MAX_NAME_LENGTH = 80

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const MATERIAL_ICON_RE = /^[a-z0-9_]{1,40}$/
// npm package names, scoped or not (lowercase, url-safe).
const PACKAGE_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const SHOW_IN = ['window', 'panel']
const CLOSE_BEHAVIORS = ['unload', 'hide']
// Side-panel apps never open at startup: their `startup` is always `never`.
const STARTUP = { window: ['always', 'remember', 'never'], panel: ['never'] }

/**
 * Whether a resolved URL may reach an iframe `src` (§6): an absolute http(s)
 * URL, or a same-origin path starting with a single `/`.
 */
function isAllowedUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return false
  if (/\s/.test(url)) return false
  if (url.startsWith('/')) return !url.startsWith('//') && !url.startsWith('/\\')
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.host
}

function isValidSuffix(suffix) {
  return (
    typeof suffix === 'string' &&
    suffix.length <= MAX_SUFFIX_LENGTH &&
    !/\s/.test(suffix) &&
    !suffix.startsWith('/') &&
    !suffix.includes('://')
  )
}

/** A toolbar icon: a Material icon name. */
function isValidIcon(icon) {
  return typeof icon === 'string' && MATERIAL_ICON_RE.test(icon)
}

/** The URL an entry shows (§3.1), or null when it cannot be resolved. */
function resolveUrl(source) {
  if (!source || typeof source !== 'object') return null
  let url = null
  if (source.type === 'webapp') {
    if (typeof source.package !== 'string' || !PACKAGE_RE.test(source.package)) return null
    const suffix = source.suffix ?? ''
    if (suffix !== '' && !isValidSuffix(suffix)) return null
    url = `/${source.package}/${suffix}`
  } else if (source.type === 'url') {
    url = source.url
  }
  return isAllowedUrl(url) ? url : null
}

class ValidationError extends Error {}

function fail(message) {
  throw new ValidationError(message)
}

/**
 * Validate one entry and return a clean copy holding only the known fields.
 * Throws ValidationError. With `{ requireId: false }` a missing id is allowed
 * (an entry being added).
 */
function cleanEntry(entry, { requireId = true } = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('An app must be an object.')
  const out = {}

  if (entry.id === undefined && !requireId) {
    // assigned by the window manager
  } else if (typeof entry.id !== 'string' || !ID_RE.test(entry.id)) {
    fail('Invalid app id.')
  } else {
    out.id = entry.id
  }

  const name = typeof entry.name === 'string' ? entry.name.trim() : ''
  if (name.length < 1 || name.length > MAX_NAME_LENGTH) fail('The name must be 1 to 80 characters.')
  out.name = name

  const src = entry.source
  if (!src || typeof src !== 'object') fail('Choose what the app shows.')
  if (src.type === 'webapp') {
    if (typeof src.package !== 'string' || !PACKAGE_RE.test(src.package)) fail('Invalid webapp package name.')
    out.source = { type: 'webapp', package: src.package }
    if (src.suffix !== undefined && src.suffix !== '') {
      if (!isValidSuffix(src.suffix)) {
        fail('The extra path must not start with "/", contain "://" or spaces, or exceed 512 characters.')
      }
      out.source.suffix = src.suffix
    }
  } else if (src.type === 'url') {
    if (!isAllowedUrl(src.url)) {
      fail('The URL must start with http://, https:// or a single "/" (at most 2048 characters).')
    }
    out.source = { type: 'url', url: src.url }
  } else {
    fail('Choose what the app shows.')
  }
  if (!resolveUrl(out.source)) fail('The resulting URL is not allowed.')

  if (!SHOW_IN.includes(entry.showIn)) fail('"Show in" must be window or panel.')
  out.showIn = entry.showIn
  if (!CLOSE_BEHAVIORS.includes(entry.closeBehavior)) fail('"Close behavior" must be unload or hide.')
  out.closeBehavior = entry.closeBehavior
  if (out.showIn === 'panel') {
    // Not a choice for side-panel apps; a list saved when it was (`always`)
    // still loads.
    out.startup = 'never'
  } else if (STARTUP.window.includes(entry.startup)) {
    out.startup = entry.startup
  } else {
    fail(`"At startup" must be one of ${STARTUP.window.join(', ')}.`)
  }

  if (entry.icon !== undefined && entry.icon !== null && entry.icon !== '') {
    if (!isValidIcon(entry.icon)) fail('Invalid toolbar icon.')
    out.icon = entry.icon
  }
  return out
}

/** Validate a whole list (§7.2) and return clean copies. Throws ValidationError. */
function cleanList(apps) {
  if (!Array.isArray(apps)) fail('"apps" must be an array.')
  if (apps.length > MAX_ENTRIES) fail(`At most ${MAX_ENTRIES} apps are allowed.`)
  const ids = new Set()
  return apps.map((a) => {
    const clean = cleanEntry(a)
    if (ids.has(clean.id)) fail(`Duplicate app id "${clean.id}".`)
    ids.add(clean.id)
    return clean
  })
}

module.exports = {
  MAX_ENTRIES,
  STARTUP,
  ValidationError,
  isAllowedUrl,
  isValidSuffix,
  isValidIcon,
  resolveUrl,
  cleanEntry,
  cleanList
}
