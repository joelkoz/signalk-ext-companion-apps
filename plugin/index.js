// signalk-ext-companion-apps
//
// A plotter extension that shows chosen webapps (or other pages) beside the
// chart: in floating windows over it (capability `windows`) or in the host's
// side panel. See REQUIREMENTS.md.
//
// The server side only serves the manifest, the web pages and the app list.
// All behaviour lives in the pages in public/: the window manager (a
// background runtime), the side panel with its launcher view, and the viewer
// shown in windows. The pages are served from a top-level static route,
// /plotterext/<package-name>/, which every user can load; /plugins/* routes
// are admin-only by default.

const path = require('path')
const { PLUGIN_ID, ASSET_BASE, buildManifest } = require('./manifest')
const { createStore, StaleRevisionError } = require('./store')
const { ValidationError } = require('./validate')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')
const pkg = require('../package.json')

module.exports = (app) => {
  let store = null
  let providerRegistered = false
  let assetsMounted = false
  let running = false
  // Who may change the list: 'readwrite' where the server supports
  // router.access (signalk-server >= 2.31), otherwise admin-only.
  let editLevel = 'admin'

  const getStore = () => {
    if (!store) {
      const dir = typeof app.getDataDirPath === 'function' ? app.getDataDirPath() : path.join(process.cwd(), PLUGIN_ID)
      store = createStore(dir, { error: (msg) => app.error(msg) })
    }
    return store
  }

  const mountAssets = () => {
    if (assetsMounted || typeof app.use !== 'function') return
    let serveStatic
    try {
      serveStatic = require('express').static
    } catch {
      app.error(`express unavailable; cannot serve ${ASSET_BASE}`)
      return
    }
    app.use(ASSET_BASE, serveStatic(PUBLIC_DIR))
    assetsMounted = true
  }

  const manifest = () => buildManifest(getStore().get().apps, pkg.version)

  const registerProvider = () => {
    if (providerRegistered) return
    if (typeof app.registerResourceProvider !== 'function') {
      app.error('server has no resource provider registry')
      return
    }
    app.registerResourceProvider({
      type: 'plotterExtensions',
      methods: {
        listResources: async () => (running ? { [PLUGIN_ID]: manifest() } : {}),
        getResource: async (id) => {
          if (!running || id !== PLUGIN_ID) throw new Error(`No such plotterExtensions resource: ${id}`)
          return manifest()
        },
        setResource: async () => {
          throw new Error(`${PLUGIN_ID} is a read-only provider`)
        },
        deleteResource: async () => {
          throw new Error(`${PLUGIN_ID} is a read-only provider`)
        }
      }
    })
    providerRegistered = true
  }

  const getApps = (req, res) => {
    const { revision, apps } = getStore().get()
    res.json({ revision, apps, editLevel })
  }

  const putApps = (req, res) => {
    const body = req.body
    if (!body || typeof body !== 'object' || !Number.isInteger(body.revision)) {
      res.status(400).json({ message: 'Expected { revision, apps }.' })
      return
    }
    try {
      const { revision } = getStore().save(body.revision, body.apps)
      res.json({ revision })
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ message: err.message })
      } else if (err instanceof StaleRevisionError) {
        res.status(409).json({ revision: err.revision })
      } else {
        app.error(`saving apps.json failed: ${err.message}`)
        res.status(500).json({ message: 'Saving the app list failed.' })
      }
    }
  }

  return {
    id: PLUGIN_ID,
    name: 'Companion Apps',
    description: 'Show webapps in windows over the chart or in the side panel of a plotterExtensions-capable chartplotter.',
    schema: () => ({ type: 'object', properties: {} }),

    registerWithRouter(router) {
      if (typeof router.access === 'function') {
        router.access('readonly').get('/apps', getApps)
        router.access('readwrite').put('/apps', putApps)
        editLevel = 'readwrite'
      } else {
        router.get('/apps', getApps)
        router.put('/apps', putApps)
        editLevel = 'admin'
        app.debug('router.access unavailable: the app list is admin-only (signalk-server < 2.31)')
      }
    },

    start() {
      try {
        getStore().load()
      } catch (err) {
        app.error(`could not read the app list: ${err.message}`)
      }
      running = true
      mountAssets()
      registerProvider()
    },

    stop() {
      running = false
    }
  }
}
