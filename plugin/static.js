// Serves the built pages in public/ (REQUIREMENTS.md §7.1) without a runtime
// dependency. `express` belongs to the Signal K server, and a plugin installed
// in ~/.signalk/node_modules cannot require() it reliably: Node resolves
// modules up the plugin's own directory tree, not the server's.

const fs = require('fs')
const path = require('path')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg'
}

/**
 * A request handler for `app.use(base, handler)`: `req.path` is relative to
 * the mount point. Only files directly under `root` with a known type are
 * served; anything else, including any path that escapes `root`, is a 404.
 */
function serveStatic(root, { fsImpl = fs } = {}) {
  const base = path.resolve(root)
  return function handler(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    let rel
    try {
      rel = decodeURIComponent(req.path || '/')
    } catch {
      return notFound(res)
    }
    if (rel.includes('\0')) return notFound(res)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = path.resolve(base, `.${path.posix.normalize(`/${rel}`)}`)
    if (!file.startsWith(base + path.sep)) return notFound(res)
    const type = TYPES[path.extname(file).toLowerCase()]
    if (!type) return notFound(res)
    fsImpl.stat(file, (err, st) => {
      if (err || !st.isFile()) return notFound(res)
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`
      res.setHeader('ETag', etag)
      // Revalidate on every load, so a plugin update is picked up at once.
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      if (req.headers?.['if-none-match'] === etag) {
        res.statusCode = 304
        return res.end()
      }
      res.setHeader('Content-Type', type)
      res.setHeader('Content-Length', st.size)
      res.statusCode = 200
      if (req.method === 'HEAD') return res.end()
      fsImpl
        .createReadStream(file)
        .on('error', () => res.destroy())
        .pipe(res)
    })
  }
}

function notFound(res) {
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('Not found')
}

module.exports = { serveStatic }
