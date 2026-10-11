# Agent Instructions

Before changing or debugging this repository, read:

1. `README.md` — end-user documentation. Keep it user-facing: no build
   commands, routes or protocol details (those belong here and in
   `REQUIREMENTS.md`).
2. `REQUIREMENTS.md` — the authoritative implementation spec: manifest,
   window-manager behaviour, panel ↔ window-manager protocol, storage, HTTP
   routes, test plan.
3. The Plotter Extensions API spec, sections *Panels*, *Windows*, *Buttons*,
   *Background Runtimes*, *Publishing events* and *State storage*:
   <https://github.com/SignalK/freeboard-sk/blob/master/docs/api/plotter-extensions-api.md>

## What this plugin is

A Signal K **plotter extension** that shows chosen webapps (or other pages)
beside the chart of a host chartplotter: in **floating windows** over the chart
(the host's `windows` capability) or in the host's **side panel**, opened from
a launcher, a navigation bar or per-app toolbar buttons. Typical uses: an echo
sounder, KIP or the Instrument Panel beside the chart.

Freeboard-SK is the reference host. The window idea and frame come from
Karl-Erik Gustafsson's "PiP App" proposal (SignalK/freeboard-sk#913); the host
side became the generic `windows` capability. The side-panel mode with a
toolbar button replaces Freeboard's built-in Instruments drawer
(SignalK/freeboard-sk#883), so that feature lives on outside the host.

It has four parts:

| Part | Kind | Job |
| ---- | ---- | --- |
| Server plugin (`plugin/`) | Node, CommonJS | Serves the manifest (fixed, plus one toolbar button per app with an icon), serves the pages, stores the app list as JSON in the plugin data directory behind a small REST route. |
| Window manager (`src/web/runtime.js`) | `background` runtime | **Decides everything that is shown**: the only code that opens, shows, hides or closes windows, and that chooses and opens the side-panel app. Loads and saves the app list, applies startup options, handles app buttons, follows window events. |
| Side panel (`src/web/sidepanel.js`) | `panels` iframe `app-panel`, `keepAlive` | The extension's **only** drawer panel. Shows either the **launcher** (its built-in view, called the **App Manager** in the UI: the app list and per-app configuration) or one side-panel app in a child `<iframe>`, whichever the window manager chose; decides which app frames to keep or drop. Never calls a window method or switches what it shows on its own. |
| Viewer (`src/web/viewer.js`) | `panels` iframe, used only in windows | Embeds the page in `context.params.url` in a full-size nested `<iframe>`. |

## Repository layout

```
plugin/     Server plugin (CommonJS, hand-written):
              index.js     plugin entry: static route, provider, REST routes
              manifest.js  the manifest and the generated buttons
              store.js     apps.json: atomic writes, corrupt file moved aside
              validate.js  entry and URL rules; also bundled into the pages
src/web/    Browser source (plain ES modules, built on
            signalk-plotterext-bus/extension):
              runtime.js   window-manager entry: wires manager.js to the bus
              manager.js   the window manager, pure (injected client and API)
              sidepanel.js side panel: launcher view and app frames
              frames.js    side-panel frame keeping, pure (injected DOM)
              nav.js       side-panel navigation bar stepping, pure
              viewer.js    the page shown in each window
              protocol.js  bus topics, ids
              icon-list.js curated toolbar icons and the launcher's own icons
              companion-apps.css, assets/
scripts/    build.mjs — esbuild bundles src/web -> public/ and inlines the
            Material icon SVGs (@material-design-icons/svg) the pages use.
public/     Built web assets. Gitignored, never committed; rebuilt by the
            `prepare` script and whitelisted in package.json `files`.
            Generated — do not hand-edit.
test/       node --test suites: *.test.js for plugin/ (CommonJS),
            *.test.mjs for src/web (window manager, frames, navigation
            bar, viewer, ids).
```

## Build / test

```sh
npm install
npm run build
npm test
```

Supported Node versions are 22 and 24 (the CI matrix). Reproduce CI failures
on Node 22 / npm 10, not only on a newer local toolchain.

End-to-end testing needs a Signal K server with this plugin installed and a
host that implements `windows`, `panels.iframe`, `buttons`,
`background.iframe` and `events.publish` (Freeboard-SK). Use a dedicated test
server; the manual test plan is in `REQUIREMENTS.md`.

## Engineering rules

- **The window manager owns what is shown.** Only `runtime.js` calls
  `ui.openWindow` / `ui.updateWindow` / `ui.focusWindow` / `ui.closeWindow`,
  and `ui.openPanel` / `ui.togglePanel` for `app-panel`. The side panel
  renders what the window manager reports and sends it requests, even to
  switch from the launcher to an app. Do not "optimise" by letting it open a
  window or switch apps directly: two owners means the launcher's buttons and
  the screen disagree.
- **The extension has exactly one drawer panel, `app-panel`,** and the
  launcher is a view inside it, not a panel or an iframe of its own (a nested
  iframe cannot reach the host bus). Do not add a second panel for the
  configuration, and do not go back to one generated panel per app: that put
  every side-panel change behind a chartplotter reload. Which child frames
  stay loaded is the side panel's decision, because only it can observe its
  own visibility.
- **Only the toolbar buttons are generated from the app list.** Hosts read
  the manifest once, when the chartplotter loads, so a button change takes
  effect after a reload; the window manager compares the list with the
  buttons the host loaded and the launcher says so.
- **Every button, the main Companion Apps button included, is a `publish`
  action** handled by the window manager, **never `toggleWindow` or
  `togglePanel`**. The host tracks only the window a
  `toggleWindow` button opened itself, so it would open a second copy of a
  window the window manager opened; a `togglePanel` button cannot say what
  the shared side panel should show.
- **The `panels.state` capability is optional** (REQUIREMENTS.md §2.2).
  Without it the side panel must still work, with the weaker *Unload*
  behaviour; never guess visibility from layout tricks instead.
- **All messages between the plugin's contexts go over the host bus with
  `client.publish(topic, params, 'extension')`** (capability
  `events.publish`). Always pass `scope: 'extension'`: the default `'all'`
  would broadcast the user's app list and requests to every other extension.
  Each side subscribes only to the topics it handles, so it never receives its
  own messages. Do not invent a side channel (`BroadcastChannel`,
  `localStorage` events, raw `postMessage`): the bus is per chartplotter page,
  which is exactly the scope these messages need.
- **Do not reach into the host's DOM** (`window.parent.document`,
  `window.parent.frames`) to find another context. It works on one host
  version and breaks on the next.
- **The app list is per boat, "Remember last" and the title bar are per
  device.** The list lives in the server JSON file; which windows were open
  and which hide their title bar live in extension-scope `state.*`
  (host-persisted, per device; REQUIREMENTS.md §4.10). Never put device-local facts in the
  server file or the list in `state.*`.
- **The launcher's window button shows what is on screen.** Its label (Open /
  Close / Hide / Show) follows the window's title bar and the host:
  `window.closed` (any reason) and `window.state` with `visible: false` both
  take the entry off screen. Never reopen a window the user just
  closed from its title bar.
- **A window can only show the extension's own panel.** Pages are shown by
  the viewer through a nested iframe. Validate every URL before it reaches an
  `src` (rules in `REQUIREMENTS.md` §6), in the window manager *and* again in
  the viewer.
- **Store writes are atomic** (write a temp file, then rename), and a corrupt
  file is moved aside, never overwritten or silently replaced by an empty
  list.
- **Serve UI assets from the top-level static route
  `/plotterext/signalk-ext-companion-apps/`, not from `/plugins/*`.** Plugin
  routes are admin-only by default and these pages must load for every user.
  Do not add the `signalk-webapp` keyword: these pages only work inside a host
  iframe and must not appear in the Webapps launcher.
- **No server-side runtime dependencies.** The bus is bundled into the browser
  assets as a devDependency at its published npm semver range, never a
  `file:` path. Do not `require('express')`: a plugin installed in
  `~/.signalk/node_modules` cannot rely on resolving the server's copy, so
  `public/` is served by `plugin/static.js`.
- **Register the resource provider on every `start()`.** The server
  unregisters it on every stop; a register-once latch loses the manifest
  after a disable/enable or a configuration save.
  If you develop against a local bus checkout, regenerate the lockfile from
  the registry before committing and confirm it has no relative-path entries.
- **Rebuild `public/` after any `src/web` edit** so a linked test server
  serves current assets; there is nothing to commit from it.
- **Toolbar icons must exist in the hosts' icon font.** Buttons carry a
  Material icon *name*; Freeboard-SK renders it with an older Material Icons
  font, so a newer name shows as text. Check a new curated icon on the
  Freeboard toolbar before adding it to `icon-list.js`.
- **An embedded chartplotter opens nothing at startup** (REQUIREMENTS.md
  §4.2). A webapp opened by this extension can embed the chartplotter, which
  loads this extension again with the same per-device state; without the
  rule it reopens that webapp inside itself, recursively.
- **Never bump `version`** in a contributor change; releases own it.
