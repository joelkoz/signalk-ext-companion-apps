// Background runtime: wires the window manager (manager.js) to the host bus
// and the Signal K server.

import { connectExtension } from 'signalk-plotterext-bus/extension'
import manifestLib from '../../plugin/manifest.js'
import { createManager, HttpError } from './manager.js'

const { PLUGIN_ID } = manifestLib
const APPS_URL = `/plugins/${PLUGIN_ID}/apps`

async function http(url, opts = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...opts })
  let body = null
  try {
    body = await res.json()
  } catch {
    // no body
  }
  if (!res.ok) throw new HttpError(res.status, body)
  return body
}

const api = {
  loadApps: () => http(APPS_URL),
  saveApps: (revision, apps) =>
    http(APPS_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision, apps })
    }),
  async loadWebapps() {
    const list = await http('/skServer/webapps')
    return (Array.isArray(list) ? list : [])
      .filter((w) => Array.isArray(w.keywords) && w.keywords.includes('signalk-webapp'))
      .map((w) => ({ package: w.name, name: w.signalk?.displayName || w.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },
  async loadButtons() {
    const m = await http(`/signalk/v2/api/resources/plotterExtensions/${PLUGIN_ID}`)
    return (m.buttons ?? []).filter((b) => b.id !== 'companion-apps')
  },
  loginStatus: () => http('/skServer/loginStatus')
}

// Whether the chartplotter page is itself inside another page. Compares
// window references only; never touches another frame's document.
const embedded = (() => {
  try {
    return window.parent !== window.top
  } catch {
    return true
  }
})()

connectExtension()
  .then((client) => createManager({ client, api, hostName: client.handshake.host, embedded }).start())
  .catch((err) => console.warn('Companion Apps manager failed to start:', err))
