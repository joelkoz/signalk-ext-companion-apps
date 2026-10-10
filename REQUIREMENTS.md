# Requirements: signalk-ext-companion-apps

This document is for AI agents implementing or reviewing this plugin. It is
the authoritative spec; `README.md` is the user guide.

The host contract this builds on is the Plotter Extensions API, sections
*Panels*, *Windows*, *Buttons*, *Background Runtimes*, *Publishing events* and
*State storage*:
<https://github.com/SignalK/freeboard-sk/blob/master/docs/api/plotter-extensions-api.md>.
The bus client is the npm package `signalk-plotterext-bus` (`^0.18.0`, the
first version with `client.windows`, `client.publish` and `client.panels`).

## 1. Purpose

Let the user show chosen webapps (or arbitrary pages) alongside the host
chartplotter's chart, either in **floating windows** over the chart or in the
host's **side panel** (drawer). The user maintains a list of **apps**. Each app
can be opened from the launcher and, optionally, from a toolbar button of its
own; per-app settings choose what it shows, where, what closing it does,
and whether it opens when the chartplotter loads.

The side-panel mode with a toolbar button replaces Freeboard-SK's built-in
Instruments drawer (removed in SignalK/freeboard-sk#883): a webapp such as KIP
in the drawer, a toolbar button that toggles it, and a choice between halting
it and keeping it running while hidden.

## 2. Host requirements and manifest

The plugin registers one read-only `plotterExtensions` resource whose id is the
package name, `signalk-ext-companion-apps`. The manifest is fixed except for the
per-app toolbar buttons (§2.1). Values are normative; `version` comes from
`package.json`:

```js
{
  name: 'Companion Apps',
  description: 'Show webapps in windows over the chart or in the side panel.',
  version: pkg.version,
  apiVersion: '1',
  requires: ['windows', 'panels.iframe', 'buttons', 'background.iframe',
             'events.publish'],
  optional: ['panels.state'],   // §2.2
  buttons: [{
    id: 'companion-apps',
    title: 'Companion Apps',
    slot: 'mapToolbar',
    icon: 'web',
    action: { type: 'publish', topic: 'signalk-ext-companion-apps.toggle',
              params: { v: 1, entryId: null }, scope: 'extension' }
  } /* , generated buttons (§2.1) */],
  panels: [
    { id: 'app-panel', title: 'Companion Apps', type: 'iframe',
      url: '/plotterext/signalk-ext-companion-apps/sidepanel.html',
      lifecycle: 'keepAlive' },
    { id: 'viewer', title: 'App', type: 'iframe',
      url: '/plotterext/signalk-ext-companion-apps/viewer.html' }
  ],
  background: [
    { id: 'window-manager', title: 'Companion Apps manager', type: 'iframe',
      url: '/plotterext/signalk-ext-companion-apps/runtime.html' }
  ]
}
```

All five required capabilities are needed: without `windows` or
`background.iframe` the extension cannot do its main job, and without
`events.publish` neither the side panel nor the buttons can reach the window
manager, so a host lacking any of them must not load it.

- `app-panel` is the extension's **one side panel**. It shows either the
  **launcher** (the list and the per-app configuration, §8) or one side-panel
  app (§4.9); the launcher is simply the side panel's built-in app. It must be
  `keepAlive`, or closing the drawer would also stop the apps set to keep
  running.
- The main button opens the launcher the same way an app button opens its app:
  it publishes `toggle` with `entryId: null`, meaning "the launcher" (§4.8).
- `viewer` is only ever opened in a window; no button opens it.

### 2.1 Generated buttons

The server builds the manifest from the current app list on every request. Each
entry with an `icon` adds one button after the launcher button, in list order:

```js
{ id: `app-${entry.id}`, title: entry.name, slot: 'mapToolbar', icon: entry.icon,
  action: { type: 'publish', topic: 'signalk-ext-companion-apps.toggle',
            params: { v: 1, entryId: entry.id }, scope: 'extension' } }
```

Every button, the main one included, publishes to the window manager, which
decides what to do (§4.8). Never use a `toggleWindow` or `togglePanel` action: the host tracks only the window a `toggleWindow` button opened
itself, so it would open a second copy of a window the window manager opened,
and a `togglePanel` button cannot choose what the shared side panel shows.

**Hosts read the manifest once, when the chartplotter loads** (Freeboard-SK
fetches it at startup), so adding, removing, renaming or re-iconing a button
takes effect after the chartplotter is reloaded. Nothing else in the list
touches the manifest. The window manager detects a pending button change and
the launcher says so (§4.7).

### 2.2 Panel visibility (`panels.state`, optional)

The `panels.state` capability (spec section *Panel state*) reports whether each
of the extension's loaded panels is on screen: `ui.listPanels` returns the
current state, and the `panel.state` event `{ panel, visible, collapsed }`
reports changes. `visible` is `false` while the drawer is closed or shows
another panel.

The plugin lists the capability as **optional**:

- with it, the side panel unloads *Unload* apps as soon as `app-panel` is
  hidden (§4.9);
- without it, *Unload* apps unload only when the user switches to another app
  in the side panel or to the launcher.

A collapsed panel (`collapsed: true`, a host feature Freeboard-SK lacks) is
still `visible` and keeps its app loaded.

The drawer header always shows the panel's manifest title, "Companion Apps": the
API has no way for a panel to change it.

## 3. Data model

An **app entry** (per boat, stored on the server):

```json
{
  "id": "k3v9x2m1q7aa",
  "name": "KIP",
  "source": { "type": "webapp", "package": "@mxtommy/kip", "suffix": "#/page/1" },
  "showIn": "panel",
  "closeBehavior": "hide",
  "startup": "never",
  "icon": "speed"
}
```

| Field | Values | Meaning |
| ----- | ------ | ------- |
| `id` | `[A-Za-z0-9_-]{1,64}`, unique | Stable identity. Also the window's `restoreKey` and the suffix of the generated button id. Generated by the window manager when an entry is added. |
| `name` | 1–80 chars after trimming | Shown in the list; the window title and button tooltip. Defaults to the chosen webapp's display name. |
| `source` | `{ type: 'webapp', package, suffix? }` or `{ type: 'url', url }` | What to show (§3.1). |
| `showIn` | `window` \| `panel` | A floating window, or the shared side panel. |
| `closeBehavior` | `unload` \| `hide` | Window: maps to `userClose: 'close'` \| `'hide'` and decides what the launcher's Close / Hide does (§4.3). Side panel: whether the app stops or keeps running while not shown (§4.9). |
| `startup` | window: `always` \| `remember` \| `never`; panel: always `never` | What happens when the chartplotter loads (§4.2). Side-panel apps never open at startup: validation stores `never` for them whatever was sent, so a list saved with the former `always` still loads. |
| `icon` | optional, `[a-z0-9_]{1,40}` | A Material icon name; when present, the entry gets its own toolbar button (§2.1). |

Defaults for a new entry: `showIn: 'window'`, `closeBehavior: 'unload'`,
`startup: 'remember'`, no `icon`. Switching an entry to `panel` sets
`startup: 'never'`; the form restores the window choice if the user switches
back.

The list holds at most 50 entries.

**Per-device state** (extension-scope `state.*`, key `openApps`): an object
`{ [entryId]: true }` of the window entries whose windows were on screen on
this device. Only `startup: 'remember'` reads it. It is never sent to the
server.

### 3.1 Resolving an entry's URL

- `webapp` → `/<package>/` followed by `suffix` if present (scoped names keep
  their scope: `/@mxtommy/kip/#/page/1`). `package` must be a valid npm package
  name. `suffix` is optional, at most 512 chars, no whitespace, must not start
  with `/` and must not contain `://`; it carries what Freeboard's old
  Instruments drawer called the app's parameters (a query string, a hash route
  or a page name).
- `url` → the URL as entered; it must pass §6.

The resolved URL must pass §6 in every case.

## 4. Window manager (background runtime)

The window manager is the only context that decides what is shown: it calls
every window method, and every `ui.openPanel` / `ui.togglePanel` for
`app-panel`. It holds:

- `entries` — the list, as last loaded from or saved to the server;
- `revision` — the server revision of that list (§7.2);
- `loadedButtons` — the generated buttons of the manifest as the host loaded
  it (§4.7);
- per window entry: `windowId` (or none) and a `status` of `closed` | `open` |
  `hidden` | `error` (with a message);
- `titleBars` — the per-device title-bar choice (§4.10);
- `panelApp` — the side-panel entry the side panel shows, or `null` for the
  launcher (the initial value).

### 4.1 Startup

1. Subscribe to the incoming topics (§5) and to `window.closed`,
   `window.state` and `window.bounds`.
2. Load the list (`GET`, §7.2), the installed webapps
   (`GET /skServer/webapps`) and the manifest
   (`GET /signalk/v2/api/resources/plotterExtensions/signalk-ext-companion-apps`,
   keeping its generated buttons as `loadedButtons`). The installed webapps
   go into every snapshot for the launcher's picker, without the host
   chartplotter's own webapp: the package named like the handshake's `host`
   (`freeboard-sk` or `@<scope>/freeboard-sk` for host `freeboard-sk`), which
   would otherwise open inside itself. A list load failure
   leaves the list empty, sets a list-level problem the launcher shows, and
   retries with backoff (5 s, doubling, capped at 5 min).
3. Apply startup options (§4.2), then publish a snapshot (§5).

### 4.2 Startup options

Window entries:

| `startup` | Opens at load when… |
| --------- | ------------------- |
| `always` | always |
| `remember` | `openApps[id]` is `true` on this device |
| `never` | never |

Windows open one after another (not in parallel), in list order, so a
`windows.limit` refusal is deterministic: the entries that did not fit get
`status: 'error'` with the limit message.

**An embedded chartplotter opens nothing at startup.** When the host page is
itself inside another page (`window.parent !== window.top` seen from the
window manager; window references only, never another frame's document),
the manager skips every startup option and never writes `openApps`. The case
that forces this: a webapp opened by this extension (e.g. a KIP dashboard)
that embeds the chartplotter. The embedded chartplotter loads this extension
too, reads the same per-device `openApps`, and would reopen that webapp
inside itself, recursively. The user can still open apps there by hand.

Side-panel entries never open at startup: the drawer would cover part of the
chart as soon as the chartplotter loads, and it shows one app at a time, so
several such entries would conflict. A window set to *Always open* serves a
dedicated helm display better. (Freeboard-SK's old Instruments drawer never
opened itself at startup either.)

### 4.3 Opening, showing, hiding, closing windows

**Bring up (request `open`; the launcher's Open / Show):**

- `closed` / `error` → open a window:
  `ui.openWindow({ panel: 'viewer', params: { url }, title: name, userClose,
  restoreKey: id, geometry })`. `geometry` is the default cascade
  `{ anchor: 'bottom-right', offset: { x: 16 + 32·i, y: 16 + 32·i },
  width: 480, height: 360 }` with `i` the entry's index mod 8; the host uses
  the remembered geometry instead whenever the `restoreKey` has one.
- `hidden` → `ui.updateWindow({ windowId, visible: true })`, then
  `ui.focusWindow`. If the host reports `windows.unknownId` (it reclaimed the
  window), open a new one; on any other failure keep the entry `hidden` with
  the error, since opening another window could leave two.
- `open` → `ui.focusWindow` (no-op otherwise).

**Take down (request `close`; the launcher's Close / Hide):**

- `closeBehavior: 'hide'` → `ui.updateWindow({ windowId, visible: false })`.
- `closeBehavior: 'unload'` → `ui.closeWindow({ windowId })`.

A `webapp` entry whose package is no longer installed does not open; it gets
`status: 'error'` ("not installed"). The same applies to showing it in the side
panel.

### 4.4 Following the host

The launcher's window button reflects what is **on screen** (`status === 'open'`).

- `window.closed` for a known window (any `reason`) → `closed`, forget the
  `windowId`. Never reopen it automatically.
- `window.state` with `visible: false` → `hidden`; with `visible: true` →
  `open`. (A collapsed window is still `open`.)
- Events for a `windowId` the manager does not know are ignored.

After every status change, update `openApps` (entry → `status === 'open'`) and
publish a snapshot.

Teardown: a reload unloads the window manager with its windows and must
**not** clear `openApps`; that is what makes `remember` work. (Verified in the
test plan, since a host that emitted `window.closed` during teardown would
break it.)

### 4.5 Editing and deleting

- **Add** (`saveEntry` with no `id`): assign an id, append, save.
- **Change** (`saveEntry` with an existing `id`): save; then:
  - window entry with a window: `name` changed only →
    `ui.updateWindow({ windowId, title })`; `source` or `closeBehavior`
    changed → close the window and reopen it with the new settings, keeping its
    visible/hidden state (a window's `params` and `userClose` cannot be changed
    in place);
  - `showIn` changed `window` → `panel`: close its window; `panel` →
    `window`: if it is `panelApp`, set `panelApp = null` (the launcher);
  - side-panel entry: the next snapshot carries it; the side panel reloads
    that app's frame if its URL changed;
  - `startup` or `icon` changed → nothing to do now (an icon change needs a
    reload, §4.7).
- **Delete**: close its window if any; if it is `panelApp`, set
  `panelApp = null` (the launcher); remove it, save, drop it from `openApps`.

Every save is a whole-list `PUT` with the current `revision` (§7.2). On
`409 Conflict` the manager reloads the list, reconciles windows and the side
panel against it (close windows of entries that no longer exist,
retitle/reopen changed ones, reset `panelApp` if its entry is gone), and
replies with
an error asking the user to repeat the change. Nothing is merged
automatically.

### 4.6 Ids

Generate entry ids (window manager) and request ids (launcher) from
`crypto.getRandomValues`, **not** `crypto.randomUUID`: the latter exists only
in secure contexts, and Signal K is commonly served over plain `http` on a LAN
address.

### 4.7 Pending reload

The manager compares the buttons the current list should generate (§2.1) with
`loadedButtons`, by id, `title`, `icon` and `action`. Any difference sets
`needsReload` in the snapshot (per entry, plus a list-level flag), and the
launcher shows "Reload the chartplotter to update the toolbar buttons." Only
buttons are affected; every other change applies at once.

### 4.8 Toolbar buttons

Every button publishes `signalk-ext-companion-apps.toggle` `{ v: 1, entryId }`.
The manager:

- **window entry** → like the launcher's button: if the window is `open`,
  **take it down**; otherwise **bring it up** (§4.3);
- **side-panel entry, or `entryId: null` (the launcher)** → if it is already
  `panelApp`, `ui.togglePanel({ panel: 'app-panel' })` (the host closes the
  drawer if `app-panel` is showing, otherwise opens it); otherwise **show** it
  (§4.9). This needs no knowledge of whether the drawer is open, which the
  manager does not have.

Unknown `entryId`s are ignored.

### 4.9 The side panel

The side panel (`app-panel`) shows one thing at a time: the launcher or one
side-panel app. The manager decides which (`panelApp`); the side-panel page
(§9.2) holds the launcher view and one child `<iframe>` per loaded app, and
shows the current one.

**Show X** (an entry, or `null` for the launcher; from a toolbar button, the
launcher's Open, or the navigation bar): set `panelApp = X`, publish a snapshot,
then `ui.openPanel({ panel: 'app-panel' })`.

The snapshot (§5) carries everything the side panel needs: `panelApp`, and
every side-panel entry with its resolved URL and `keep`
(`closeBehavior === 'hide'`). The side panel converges on each snapshot,
dropping frames of deleted entries and reloading changed ones.

Which frames stay loaded is the side panel's job (§9.2), since only it can
observe its own visibility:

- the current app is always loaded; the launcher view is always there (it is
  part of the page, not a frame);
- switching away from an app keeps a *Hide* app's frame (hidden, still
  running) and removes an *Unload* app's frame;
- with `panels.state` (§2.2), when `app-panel` is hidden the
  current *Unload* app's frame is removed, and recreated when it is shown
  again. Without it, the current app keeps running while the drawer is closed.

### 4.10 Title bar (per device)

A window entry's title bar is either `fixed` (the host default) or
`autoHide`: the host's title bar floats over the page and fades when idle,
and the host keeps a grip that brings it back (`ui.openWindow` `titleBar`).
The host's close control never goes away, so this is the closest a window
gets to a kiosk view.

- **Per device, not per boat.** A helm tablet wants bare windows; the laptop
  at the chart table wants title bars to drag. The choice lives in
  extension-scope state as `titleBars` (`{ [entryId]: 'autoHide' }`; absent
  means `fixed`), next to `openApps`, never in the server list. Changing it
  needs no edit rights, like opening and closing apps. An embedded
  chartplotter (§4.2) applies it and writes it too: unlike `openApps`, it is
  only ever written by an explicit user action.
- **Open**: `ui.openWindow` carries `titleBar: 'autoHide'` for such an entry
  and leaves the field out otherwise.
- **`setTitleBar`** (§5.1): store the choice (dropping ids of entries that no
  longer exist), then, if the entry has a live window (`open` or `hidden`),
  close it and reopen it in the same visible/hidden state: `ui.updateWindow`
  cannot change `titleBar`, so the page reloads; `restoreKey` keeps its
  place. A closed window just opens with it next time. Same value → nothing.
  Unknown entry, side-panel entry or a value other than `fixed` / `autoHide`
  → error reply, nothing stored. A reopen that fails (e.g. `windows.limit`)
  leaves the entry in `error` and replies with that error.
- **Delete** drops the entry's choice.

## 5. Bus protocol

The side panel, the toolbar buttons and the window manager talk over the host
bus: each publishes with `client.publish(topic, params, 'extension')`
(capability `events.publish`) and subscribes with `client.subscribe` to the
topics it handles.

- **Always `scope: 'extension'`.** The default `'all'` would deliver the app
  list and the user's requests to every other extension on the page.
- **Topics** follow the spec's dotted convention,
  `signalk-ext-companion-apps.<name>`, so a host event can never collide with
  them.
- **Each side subscribes only to the topics addressed to it.** The host
  delivers a publish to the publisher too if it subscribed, so subscribing to a
  wildcard such as `signalk-ext-companion-apps.*` would echo every message back.
- **Scope is one chartplotter page.** The host bus is per page, so a second
  Freeboard tab, or another device, never sees these messages.
- **No sender identity.** Published events carry none, so the protocol never
  depends on who sent a message, only on its topic and `reqId`.

### 5.1 Messages

Every `params` object carries `v: 1`; a receiver ignores any other version.
Topics are listed without the `signalk-ext-companion-apps.` prefix.

To the window manager:

| Topic | From | Params | Effect |
| ----- | ---- | ------ | ------ |
| `hello` | side panel | — | Publish a snapshot. |
| `setOpen` | side panel | `reqId`, `entryId`, `open` | Window entry: §4.3. Side-panel entry, or `null` for the launcher, with `open: true`: show it (§4.9). |
| `toggle` | buttons | `entryId` | §4.8. No reply. |
| `setTitleBar` | side panel | `reqId`, `entryId`, `titleBar` (`fixed` \| `autoHide`) | §4.10. |
| `saveEntry` | side panel | `reqId`, `entry` | §4.5 (add when `entry.id` is absent). |
| `deleteEntry` | side panel | `reqId`, `entryId` | §4.5. |
| `reload` | side panel | `reqId` | Re-fetch the list, the installed webapps and the user's rights (`canEdit`), then reconcile. Sent by the launcher's **Check again** (on the list-problem banner and the "editing unavailable" note) and, with `panels.state`, whenever `app-panel` is shown with the App Manager, so a login made after the chartplotter loaded is picked up. |

From the window manager to the side panel:

| Topic | Params |
| ----- | ------ |
| `snapshot` | `entries`; `urls` (`{ [id]: resolvedUrl }`, side-panel entries); `status` (`{ [id]: { state?, titleBar?, error?, needsReload } }`, `state` and `titleBar` for window entries only); `panelApp` (entry id or `null`); `needsReload` (bool); `canEdit` (bool, §7.3); `editLevel` (`readwrite` \| `admin`, §7.3); `editReason?` (why editing is unavailable); `webapps` (`[{ package, name }]`, §4.1); `problem?` (list-level message) |
| `reply` | `reqId`, `ok`, `error?` (`{ code, message }`); `entryId` on a successful `saveEntry` |

The manager publishes a `snapshot` after every change, so the side panel never
holds its own copy of window or side-panel state; even switching from the
launcher to an app goes through `setOpen` and comes back as a snapshot.
`reqId` is generated by the side panel (§4.6) and only lets it match a `reply`
to the request that caused it.

Every request the side panel sends expects its `reply` within 10 s; after that
it fails with "The Companion Apps manager did not respond. Reload the
chartplotter." (a publish succeeds whether or not anyone is subscribed, so
without the timeout a form would stay on "Saving…"). The manager answers
`hello` only once its startup has loaded the list, so a side panel opened
during startup never shows an empty list first.

The window manager loads before the user can open the side panel, but the side
panel must not assume it: if it gets no snapshot within 3 s of `hello`, its
launcher shows "The Companion Apps manager is not running. Reload the
chartplotter." and keeps retrying `hello`. A `snapshot` arriving at any time
replaces its view.

## 6. URL rules

A resolved URL (§3.1) is accepted only if it is either:

- an absolute `http:` or `https:` URL, or
- a same-origin path beginning with a single `/` (not `//`).

Everything else (`javascript:`, `data:`, `blob:`, `file:`, relative paths,
protocol-relative `//host`) is rejected. The server validates on `PUT`, the
window manager before `openWindow` and before putting a URL in a snapshot,
and the viewer and the side panel before setting any `src`. Maximum length
2048.

The launcher warns, without blocking, when the chartplotter is on `https:` and
the URL is `http:` (the browser will block it as mixed content).

## 7. Server plugin

### 7.1 Assets and manifest

- Serve `public/` at `/plotterext/signalk-ext-companion-apps/` (`app.use`),
  as a public route, with the plugin's own small static handler
  (`plugin/static.js`): GET/HEAD only, known file types only, nothing outside
  `public/`, `Cache-Control: no-cache` with an ETag. Not `express.static`: a
  plugin installed in `~/.signalk/node_modules` cannot rely on resolving the
  server's `express`, and without it every page would 404.
- Register the `plotterExtensions` provider (all four methods; `set`/`delete`
  reject) on **every** `start()`: the server unregisters a plugin's resource
  providers when it stops it, so registering once would lose the manifest
  after the plugin is disabled and re-enabled or its configuration is saved.
  List the manifest only while the plugin is started. Build it from the
  in-memory list on every `list`/`get` (§2.1).

### 7.2 App list storage and routes

Stored at `<app.getDataDirPath()>/apps.json`:

```json
{ "version": 1, "revision": 7, "apps": [ /* entries, §3 */ ] }
```

- A missing file is an empty list at revision 0.
- Writes are atomic: write `apps.json.tmp`, then rename.
- A file that fails to parse or validate is renamed to
  `apps.json.corrupt-<timestamp>`, logged with `app.error`, and replaced by an
  empty list, so the user's data is kept for recovery.
- The list is read before its first use, by `start()` or by the first
  request, since the routes exist even while the plugin is stopped. Until a
  read succeeds (any read error other than a missing file, or a corrupt file
  that cannot be moved aside), both routes answer `503 { message }` and
  nothing is written, so a file that could not be read is never replaced.

Routes, on the plugin router (`/plugins/signalk-ext-companion-apps`):

| Method | Path | Body | Result |
| ------ | ---- | ---- | ------ |
| `GET` | `/apps` | — | `200 { revision, apps, editLevel }` (`editLevel`: who may `PUT`, §7.3) |
| `PUT` | `/apps` | `{ revision, apps }` | `200 { revision }` (incremented); `400 { message }` if invalid (§3, §6); `409 { revision }` if `revision` is stale; `503` while the list cannot be read |

`PUT` validates the whole list: field rules (including the per-`showIn`
`startup` values), unique ids, at most 50 entries, nothing extra stored
(unknown fields are dropped).

### 7.3 Access levels

- On servers that provide `router.access` (signalk-server ≥ 2.31): `GET` is
  `access('readonly')`, `PUT` is `access('readwrite')`.
- On older servers, register both directly on the router, which makes them
  admin-only when security is enabled. Log this once at start.
- **Editing the list is trusted at the `readwrite` level.** An entry's page
  loads, with scripts and same-origin access, in every viewer's chartplotter,
  an admin's included. A `readwrite` user can already change the boat's data,
  and core Signal K offers no way for one to have HTML served from the server
  origin, so this grants no new power today; a deployment that lets
  `readwrite` users publish pages on the server origin should keep the list
  admin-only.
- The window manager sets `canEdit` from `GET /skServer/loginStatus`:
  `true` when security is off, or the user level is `readwrite`/`admin`
  (`admin` only on servers without `router.access`, which `GET /apps`
  reports as `editLevel: 'admin'`). A `401`/`403` on a save
  sets it to `false` regardless. A read-only user can still open and close
  apps (that is device-local), but cannot add, change or delete them; the
  launcher shows editing as unavailable with the reason.

## 8. Launcher

The launcher is the side panel's built-in app: a view of the side-panel page
(§9.2), shown when `panelApp` is `null`. Users see it as the **App Manager**
(the name the navigation bar shows, §9.3); the code and this spec call it the
launcher. The main toolbar button shows it
(§4.8), and every app's frame gives way to it the same way.

- **List**: one row per entry, then an **"Add new application"** row.
  - **Window entry**: a button (left) labelled with what pressing it does,
    from the snapshot: **Open** (`closed` / `error`), **Close** (`open`,
    *Unload*), **Hide** (`open`, *Hide*), **Show** (`hidden`); Close / Hide
    are highlighted, since the window is on screen. Then the name, a short
    status hint for `hidden`
    ("running hidden") or `error` (e.g. "not installed", "window limit
    reached"), a **title-bar switch** (§4.10; a window icon, struck
    through and highlighted while the title bar hides when idle, with
    `aria-pressed`; it says when the open window will reload, sends
    `setTitleBar` and is disabled until the reply), and an **(i)** button
    opening the entry's configuration. The switch is on the row, not in the
    configuration form, because it is per device: the form edits the boat's
    list, needs edit rights and has Save / Cancel.
  - **Side-panel entry**: an **Open** button in the same place (the app
    takes the launcher's place in the side panel; the main button brings the
    launcher back), name, a "side panel" hint, and **(i)**. Open sends
    `setOpen` with `open: true`; the side panel never switches to an app by
    itself.
  - The entry's toolbar icon, if any, is shown beside its name.
- A banner shows "Reload the chartplotter to update the toolbar buttons."
  while the snapshot's `needsReload` is set.
- **Configuration** (replaces the list in the launcher; Back returns). The
  launcher keeps its view state, including a half-edited form, while an app is
  shown:
  1. **Open**: an installed webapp (picker from `GET /skServer/webapps`,
     listing only packages with the `signalk-webapp` keyword, excluding the
     host chartplotter itself, labelled with `signalk.displayName` or the
     package name) with an optional **Extra path or parameters** field (the
     `suffix`), **or** a custom URL, with the restrictions of §10 shown under
     the field.
  2. **Name**: prefilled from the webapp's display name until the user edits
     it.
  3. **Open in**: *Window* (floats over the chart) or *Side panel*.
  4. **Close behavior**: *Unload* or *Hide*, explained for the chosen
     **Open in**: for a window, "the close button closes the app" / "the app
     keeps running hidden; open it again to bring it back"; for the side
     panel, "the app stops when you leave it" / "the app keeps running while
     not shown".
  5. **At startup** (windows only; hidden for side-panel apps): *Always
     open* / *Remember last* / *Never open*.
  6. **Toolbar button**: a drop-down list (like Freeboard-SK's note icon
     picker) of *None* and a curated list of Material icons, each shown as
     the icon and a short name (Speed, Dashboard, Waves, Sailing, Boat,
     Anchor, Compass, Map, Radar, Satellite, Wind, Weather, Temperature,
     Water, Fuel, Battery, Power, Solar, Camera, Sensors, Controls, Apps;
     `src/web/icon-list.js`). The main button's icon, `web`, is not offered; an icon dropped from
     the list (`RETIRED_ICONS`) stays bundled and named, so entries saved with
     it keep drawing it. It opens upward when the panel has no
     room below. Every name must exist in the hosts' toolbar icon font:
     Freeboard-SK bundles an older Material Icons font without newer names
     such as `gas_meter` or `solar_power`. The launcher draws the icons from
     SVGs inlined at build time, so it needs no icon font. A note says the
     button appears after the chartplotter is reloaded. Symbols from the
     Signal K symbols resource are a possible later addition, once the
     Plotter Extensions API defines the button's reserved `symbol` field.
  7. **Save**, **Cancel**, and for an existing entry **Delete** (with an
     inline confirmation: the sandbox has no `confirm()` dialog).
- The launcher never stores window or side-panel state; it renders the latest
  snapshot. While the configuration form is open, snapshots update its state
  but do not re-render it, so typing is never interrupted.
- Follows the host's night mode if the host offers it (optional; do not
  require the capability).

## 9. Pages that show apps

### 9.1 Viewer (windows)

Reads `client.context.params.url`, validates it (§6), and sets it as the `src`
of one full-size `<iframe>` (no border, filling the window). On a missing or
invalid URL it shows a short message instead. It adds no chrome of its own:
the host owns the title bar and close control.

### 9.2 Side panel (`app-panel`)

- The page is the bus context. It contains the launcher view (§8) and a
  container of full-size child `<iframe>`s, one per loaded app, keyed by
  `entryId`. Only the current one (the launcher view or one frame) is
  displayed; the others are hidden without being removed (removing or moving a
  frame reloads it).
- On load, it subscribes to `snapshot` and `reply` and publishes `hello`.
  With `panels.state` (§2.2) it also subscribes to `panel.state`, then reads
  its initial state with `ui.listPanels`, and acts only on entries for its own
  panel (`panel === context.id`).
- On every `snapshot`:
  - if `panelApp` is an entry, create its frame if missing and show it; if it
    is `null`, show the launcher view;
  - reload a frame whose URL changed; remove frames of entries that are gone
    or no longer side-panel entries;
  - when the current app changed, remove the previous app's frame if it is not
    `keep`.
- With `panels.state`: on `visible: false`, remove the current app's frame if
  it is not `keep`; on `visible: true`, recreate it.
- Validates every URL (§6) before it reaches a `src`.
- It never decides on its own to switch what it shows; every switch is a
  request to the window manager.

### 9.3 Navigation bar

While the list holds at least one side-panel entry, the side panel shows a
40 px bar at its top, under the host's title bar, above both the launcher and
the app frames (the successor of the previous/next arrows in Freeboard-SK's
old Instruments drawer):

- **‹ previous** and **› next** cycle through the App Manager and the
  side-panel entries: the App Manager first, then the entries in list order,
  wrapping around (so with one entry they alternate between it and the App
  Manager).
- **The label** shows the current entry's icon and name, or a gear and "App
  Manager" for the launcher.
- **⚙ gear** is a shortcut straight to the App Manager; disabled while it is
  showing.
- Every press sends `setOpen` with `open: true` (`entryId: null` for the
  gear); the bar re-renders from each snapshot. A failed request (e.g. "not
  installed") shows in the label for 4 s.
- Without side-panel entries the bar is hidden and the launcher fills the
  panel.

Window entries are not in the cycle: they are not shown in the side panel.

## 10. Limitations to document in the README

- **At the very top, while Freeboard-SK 3.3.0 is in beta: the minimum host
  version** (3.3.0 is the first with `windows` and `events.publish`), since
  the README is the App Store page. An older host skips the extension
  entirely (its `requires` are not met), so without this note the plugin
  seems to do nothing. Remove the note once 3.3.0 or later is the stable
  (`latest`) Freeboard-SK release; the version stays in the sentence below
  it.

- **Custom URLs work only for pages that allow being framed.** Pages on the
  Signal K server always work. Other sites must not send
  `X-Frame-Options: DENY/SAMEORIGIN` or a restrictive CSP `frame-ancestors`. An
  `http:` page will not load in an `https:` chartplotter. A refusal cannot be
  detected reliably; the window or panel shows the browser's blocked-page
  message. (List which kinds of sites were verified during testing.)
- **Apps run inside the extension sandbox** (`allow-scripts allow-same-origin
  allow-forms`): no popups, no top-level navigation, no `alert`/`confirm`
  dialogs. Some webapps' login or export flows may not work.
- **Each open window or loaded side-panel app is a full webapp running on the
  device** (often a Raspberry Pi or a tablet). Hidden windows and *Hide*
  side-panel apps keep running too.
- **The host limits open windows** (Freeboard-SK: 12, all extensions
  together) and may close a hidden window to make room; its entry's button goes back to Open.
- **Toolbar buttons appear after a reload** of the chartplotter, as do changes
  to them.
- **One side panel**: side-panel apps and the launcher share the extension's
  one side panel, which shows one of them at a time; the Companion Apps button
  brings the launcher back. Side-panel apps never open at startup.
- **Unload in the side panel** (on hosts without `panels.state`): the app stops when you switch to another side-panel app or to
  the launcher, not when you close the drawer.
- **Kiosk mode** hides the toolbar, so the launcher and the buttons cannot be
  reached there; apps set to open at startup still open, which suits a kiosk
  display. Their title-bar choice (§4.10) applies there too, so set it up on
  that device before turning kiosk mode on.
- **Hiding a window's title bar** is per device, makes it fade when idle
  rather than disappear (the host keeps a way back and the close control),
  and reloads an open window when switched.
- **"Remember last" is per device**; two chartplotter tabs in the same
  browser share it.
- **Migrating from Freeboard's Instruments drawer**: add the app with *Show
  in: Side panel*, *Hide* if it should keep running while closed ("Halt App on
  hide" off), and a toolbar button; put the old parameters in *Extra path or
  parameters*. Several favourites become several entries, each with a button,
  switching instantly between *Hide* apps.
- Credit Karl-Erik Gustafsson for the PiP App idea and the window frame.

## 11. Packaging

- `main: plugin/index.js`; keywords `signalk-node-server-plugin`,
  `signalk-category-chart-plotters`, **not** `signalk-webapp`.
- `"signalk-plugin-enabled-by-default": true` (needs no configuration).
- `files`: `plugin`, `public`, `src/web/assets/companion-apps.png`,
  `docs/screenshots`, `README.md`, `CHANGELOG.md`, `LICENSE`.
- `prepare` runs the build; `public/` is gitignored.
- `signalk.appIcon` is the committed source file
  `src/web/assets/companion-apps.png`, whitelisted in `files` (a path under
  the gitignored `public/` fails plugin-ci's source-path check).
- `signalk.screenshots` lists `docs/screenshots/*` (≤1280×800, ≤500 KB; the
  first is the App Store hero image).
- `CHANGELOG.md` is in the tarball (the registry reads it from there).
- `engines.node`: `>=22`.

## 12. Non-goals

- Several side panels at once (the host drawer shows one panel), or a second
  extension panel for the configuration.
- Applying toolbar-button changes without a chartplotter reload (that needs
  the host to re-read manifests; a host-side change, not this plugin's).
- Guessing the side panel's visibility from layout tricks
  (`IntersectionObserver`, frame size) on hosts without `panels.state`.
- Importing Freeboard's old Instruments drawer settings automatically.
- Arranging, tiling or snapping windows; the host and the user own geometry.
- Syncing which windows are open across devices.
- A window list or "bring back hidden window" control outside the launcher
  and the toolbar buttons (the host deliberately has none).
- Detecting whether a custom URL refuses framing.

## 13. Test plan

### 13.1 Unit tests (`node --test`)

- **Manifest**: fixed part of §2 (exactly two panels, `app-panel`
  `keepAlive` and `viewer`; the visibility capability optional, not
  required; the main button publishes `toggle` with `entryId: null`); one
  generated button per entry with an `icon`, in list order, every one a
  `publish` action with `scope: 'extension'` (never `toggleWindow` /
  `togglePanel`); a `PUT` changes
  the next manifest; provider is read-only; listed only while started.
- **Store**: missing file → empty/rev 0; round-trip; atomic write (no partial
  file on a simulated write failure); corrupt file moved aside and logged;
  revision increments.
- **Validation**: every field rule in §3 and §3.1, including any `startup`
  stored as `never` for `showIn: 'panel'`, `suffix` rules and `icon` pattern; unique
  ids; 50-entry cap; every URL case in §6, accept and reject; unknown fields
  dropped.
- **Routes**: `GET`/`PUT` happy paths, `400`, `409`; `router.access` used when
  present, plain routes when absent; the stored list is read (and a stale
  `PUT` refused) while the plugin is stopped; `503` and no write while the
  list cannot be read; the provider is registered again on every `start()`
  after the server dropped it on stop.
- **Static handler**: serves files under `public/` with their type, ETag →
  `304`, `HEAD`; `404` for traversal (plain and percent-encoded), unknown
  types, directories, NUL bytes and malformed escapes; other methods passed
  on.
- **Window manager** (pure module driven by a fake client and fake store;
  also: an embedded chartplotter applies no startup options and leaves
  `openApps` alone, and the host's own webapp is left out of `webapps`):
  - window startup for `always` / `remember` (flag on and off) / `never`;
    side-panel entries never open at startup, even saved with `always`;
  - bring up on `closed`, `hidden`, `open`; take down with `hide` and `unload`;
  - `toggle`: window entry on open / hidden / closed; side-panel entry or
    `null` that is `panelApp` → `togglePanel`; otherwise → show (snapshot then
    `openPanel`); unknown entry ignored;
  - `window.closed` (user, host, extension) and `window.state` visible
    true/false update status and `openApps`;
  - unknown `windowId` events ignored;
  - edits: name → `updateWindow` title; source / close behavior → close +
    reopen preserving hidden state; `showIn` changes in both directions;
    deleting the current side-panel app returns `panelApp` to `null`; delete
    closes the window;
  - `needsReload` set for each kind of button change and cleared when the
    list matches `loadedButtons`; non-button changes never set it;
  - `windows.limit` → `error` on the remaining entries;
  - `409` → reload, reconcile, error reply;
  - title bar (§4.10): `autoHide` from state reaches `openWindow` (and the
    default is not sent) and the snapshot; `setTitleBar` reopens an open
    window open and a hidden one hidden, only remembers it for a closed
    one, does nothing for the same value, never saves the list; unknown,
    side-panel and malformed requests refused; a failed reopen replies with
    the error; deleted entries' choices dropped; an embedded chartplotter
    applies and stores it;
  - showing a hidden window reopens it only on `windows.unknownId`;
  - `hello` is answered only after startup has loaded the list;
  - uninstalled webapp → `error`, no `openWindow` / no side-panel show.
- **Navigation bar** (`nav.js`, pure): the cycle is the App Manager then the
  side-panel entries in list order (window entries excluded); next/previous
  wrap; a single entry alternates with the App Manager; nothing to step to
  with no entries.
- **Side panel** (frame manager as a pure module over a fake DOM): converges
  on `snapshot` (launcher view for `null`, create, reload on URL change,
  remove deleted); switching, including to the launcher, keeps *Hide* frames
  and drops *Unload* frames; with visibility events, hide
  drops a current *Unload* frame and show recreates it; without them, the
  current frame is never dropped; invalid URLs never reach `src`.
- **Protocol**: every publish uses `scope: 'extension'` and a
  `signalk-ext-companion-apps.` topic; each context subscribes only to its own
  incoming topics; every `setOpen` / `saveEntry` / `deleteEntry` gets exactly
  one `reply`; a `snapshot` follows every change; a `v` other than 1 is
  ignored; ids come from `getRandomValues`.
- **Viewer**: uses `params.url`; invalid URLs never reach `src`.

### 13.2 End-to-end (manual, against a test Signal K server)

Host: a Freeboard-SK build that includes the `windows` and `events.publish`
capabilities, and (for steps 18–19) one with `panels.state`.
Webapps: `@signalk/instrumentpanel`, `@mxtommy/kip`, plus a custom same-origin
URL and two external sites (one that allows framing, one that refuses it).
Include a KIP dashboard that embeds the chartplotter, to cover the embedded
startup rule (§4.2): opening it in a window with *Remember last* must not
nest windows.

Windows:

1. The Companion Apps button toggles the side panel showing the launcher; list
   empty; add KIP (name prefilled).
2. Open → window opens titled "KIP", button reads Close; Close with *Unload*
   → window gone, button reads Open.
3. Switch to *Hide*; Open, Hide → window hidden, button reads Show; Show → same app state
   (no reload) is back.
4. Close from the title bar with *Unload* → button reads Open. With *Hide* →
   button reads Show; Show brings it back without reloading.
5. Move/resize a window, close it, reopen → same place. Reload → same place.
6. Startup: *Always* opens after reload; *Remember last* opens only if it was
   open before the reload (check both); *Never* stays closed.
7. Open the chartplotter in a second tab of the same browser: opening an app
   in one tab does not affect the other (the bus is per page).
8. Edit the name of an open entry → title changes in place. Change its source
   → window reloads with the new page.
9. Delete an open entry → window closes, entry gone, still gone after reload
   and on a second device.
10. Open more windows than the host allows → the extra entry shows the limit
    error; hidden windows are reclaimed first and their buttons read Open.
11. Phone-width viewport → windows become sheets; the buttons still follow.
11a. Title bar: press the row's window icon on an open window → it reloads
    in place with a title bar that fades when idle, and the grip brings it
    back; on a hidden window it stays hidden. Reload → still bare. A second
    device still shows the title bar. A read-only user can switch it.

Side panel and buttons (the #883 replacement):

12. Add KIP with *Open in: Side panel*, *Hide*, and an extra path such as a
    KIP dashboard route; **without reloading**, Open → KIP shows in the drawer
    at that path.
13. Give it the `speed` button → reload banner; reload → the button is on the
    toolbar and the banner is gone. Press → drawer shows KIP; press → drawer
    closes; press → KIP is back without reloading.
14. Add Instrument Panel as a second side-panel app with *Unload* and its own
    button. Switch KIP → Instrument Panel → launcher → KIP: KIP never reloads;
    Instrument Panel reloads each time it is shown; the launcher keeps a
    half-edited form across the switches.
15. With KIP showing, the Companion Apps button switches to the launcher;
    pressing it again closes the drawer; deleting KIP while it is current
    leaves the launcher showing.
15a. Navigation bar: hidden with no side-panel apps; with KIP and Instrument
    Panel, › cycles App Manager → KIP → Instrument Panel → App Manager (‹ the
    other way), keeping KIP loaded (Hide) and reloading Instrument Panel
    (Unload); the gear jumps to the App Manager from either app.
16. A window entry with a button: the button toggles the window, the
    launcher button follows, and the button never opens a second copy of a
    window the launcher or startup opened.
17. Side-panel apps show no *At startup* field; switching an entry to
    *Side panel* and back to *Window* restores its window choice. After a
    reload the drawer stays closed.
18. With `panels.state`: an *Unload* side-panel app unloads when the drawer
    closes and when another extension's panel is shown, and reloads when shown
    again; a *Hide* app keeps running throughout.
19. Without it: closing the drawer leaves the *Unload* app running until
    another side-panel app or the launcher is shown.
20. Every icon in the curated list renders on the Freeboard toolbar.
    (Check each name against the host page's `material-icons` font: an
    unknown name renders as text, many times wider than an icon.)

General:

21. Log in as a read-only user → opening and closing apps works, editing shows
    as unavailable. On a server without `router.access`, as admin → editing
    works.
22. Custom URLs: same-origin path works; framing-allowed external site works;
    framing-refused site shows the browser's blocked page; `javascript:` is
    rejected in the form.
23. Over plain `http` on a LAN address (not localhost): adding an entry works
    (ids without `randomUUID`).
