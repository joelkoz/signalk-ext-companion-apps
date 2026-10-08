// The plotterExtensions manifest (REQUIREMENTS.md §2, §2.1). Shared with the
// window manager, which compares the buttons the list should generate with
// the ones the host loaded (§4.7).

const PLUGIN_ID = 'signalk-ext-companion-apps'
const ASSET_BASE = `/plotterext/${PLUGIN_ID}`
const TOGGLE_TOPIC = `${PLUGIN_ID}.toggle`

function toggleAction(entryId) {
  return { type: 'publish', topic: TOGGLE_TOPIC, params: { v: 1, entryId }, scope: 'extension' }
}

/** One toolbar button per entry with an icon, in list order (§2.1). */
function generatedButtons(entries) {
  return entries
    .filter((e) => e.icon)
    .map((e) => ({
      id: `app-${e.id}`,
      title: e.name,
      slot: 'mapToolbar',
      icon: e.icon,
      action: toggleAction(e.id)
    }))
}

function buildManifest(entries, version) {
  return {
    name: 'Companion Apps',
    description: 'Show webapps in windows over the chart or in the side panel.',
    version,
    apiVersion: '1',
    requires: ['windows', 'panels.iframe', 'buttons', 'background.iframe', 'events.publish'],
    optional: ['panels.state'],
    buttons: [
      {
        id: 'companion-apps',
        title: 'Companion Apps',
        slot: 'mapToolbar',
        icon: 'web',
        action: toggleAction(null)
      },
      ...generatedButtons(entries)
    ],
    panels: [
      {
        id: 'app-panel',
        title: 'Companion Apps',
        type: 'iframe',
        url: `${ASSET_BASE}/sidepanel.html`,
        lifecycle: 'keepAlive'
      },
      { id: 'viewer', title: 'App', type: 'iframe', url: `${ASSET_BASE}/viewer.html` }
    ],
    background: [
      {
        id: 'window-manager',
        title: 'Companion Apps manager',
        type: 'iframe',
        url: `${ASSET_BASE}/runtime.html`
      }
    ]
  }
}

module.exports = { PLUGIN_ID, ASSET_BASE, TOGGLE_TOPIC, buildManifest, generatedButtons }
