# Freeboard SK Companion Apps

> **Requires Freeboard-SK 3.3.0 or later**
> 
> On older versions of Freeboard-SK, Companion Apps does not
> appear: no toolbar button, no side panel.

Integrate your favorite webapps with Freeboard SK! *Companion Apps* embeds any webapp (KIP, Instrument Panel, an echo sounder, …) or any web page either in
**floating windows over the chart** or in the chartplotter's **side panel**,
opened from the included App Manager or from toolbar buttons of their own.

It is a plotter extension: it works in chartplotters that support Signal K
plotter extensions with floating windows, such as Freeboard-SK 3.3.0 or later.

## Getting started

1. Install **Companion Apps** from the Signal K App Store. It is enabled
   automatically.
2. Open (or reload) your chartplotter. A new **Companion Apps** button
   (a web-page icon) appears on its toolbar.
3. Press it. The side panel shows the **App Manager**, your list of apps.
   Choose **Add new application**.

## Adding an app

- **Open**: pick an installed webapp, optionally with an **extra path or
  parameters** (for example a KIP dashboard page such as `#/page/1`), or
  enter the address of a web page.
- **Name**: filled in from the webapp; change it if you like. It is the
  window's title and the toolbar button's tooltip.
- **Open in**: *Window* floats over the chart; *Side panel* shows the app in
  the chartplotter's side panel.
- **Close behavior**:
  - *Unload*: closing the app stops it.
  - *Hide*: the app keeps running out of sight, and comes back exactly as you
    left it.
- **At startup** (windows only): *Always open*, *Never open*, or *Remember
  last*, which reopens the windows that were open when you last used this
  device. Side-panel apps open only when you open them.
- **Toolbar button**: pick an icon to give the app its own toolbar button.
  The button appears after you reload the chartplotter.

## Using it

- **Windows**: each window app has a button that says what it will do:
  **Open**, then **Close** (or **Hide**, for apps set to *Hide*) while the
  window is on screen, and **Show** for a hidden one. Drag and resize windows as you like; each one remembers its place
  on each device. The window's own close button does the same as **Close** / **Hide**.
- **Hide the title bar**: the window icon next to a window app makes its
  title bar fade away when you are not using it, for a cleaner, kiosk-like
  view; touch or hover the top edge to bring it back. It is set **per
  device**, so the helm tablet can show bare windows while the laptop keeps
  its title bars, and it needs no login. An open window reloads when you
  switch it.
- **Side panel**: press **Open** next to an app. It takes the App Manager's
  place in the side panel, which shows one app at a time. A bar at the top of
  the side panel steps through the App Manager and your side-panel apps with
  **‹** and **›**; the **⚙** gear (or the Companion Apps toolbar button) jumps
  straight back to the App Manager.
- **Toolbar buttons** toggle their app: a window opens and closes; a side
  panel app opens, and pressing again closes the side panel.

The app list is shared by everyone using this Signal K server. Which windows
were open ("Remember last") and which hide their title bar are kept per
device. Adding or changing apps needs
a Signal K login with read/write access. Anyone who can see the list can
open and close the apps: on Signal K servers older than 2.31 that is admins
only, as the list itself is admin-only there.

## Moving from Freeboard-SK's Instruments drawer

Freeboard-SK's built-in Instruments drawer is replaced by Companion Apps. To get
the same setup back:

1. Add the webapp (for example KIP) with **Open in: Side panel**.
2. Choose **Hide** if it should keep running while closed (the old "Halt App
   on hide" switched off), or **Unload** if it should stop.
3. Put the old app parameters in **Extra path or parameters**.
4. Give it a **toolbar button**, then reload the chartplotter.

Several favourites become several entries, each with its own button. Apps set
to *Hide* switch instantly.

## Limitations

- **Web pages from other sites must allow being shown inside another page.**
  Pages on your Signal K server always work. Many public sites refuse (for
  example github.com) and show an empty window; sites that allow it (for
  example example.com) work. A page on `http:` does not load in a
  chartplotter opened over `https:`.
- **Apps run in a protected frame**: they cannot open popups or new tabs, or
  show pop-up dialogs. Some webapps' login or export features may not work
  there.
- **Every open window and every loaded side-panel app is a full webapp
  running on your device**, hidden ones included. On a Raspberry Pi or an
  older tablet, keep a few open, not a dozen.
- **The chartplotter limits open windows** (Freeboard-SK: 12, all extensions
  together) and may close a hidden window to make room. The app's button then
  goes back to **Open**.
- **Toolbar buttons appear after a reload** of the chartplotter, as do
  changes to them.
- **One side panel**: side-panel apps and the App Manager share it, and it
  shows one at a time.
- **Unload in the side panel** stops the app as soon as the side panel is
  closed on chartplotters that report it (Freeboard-SK does). On others, it
  stops when you switch to another app or back to the App Manager.
- **Kiosk mode** hides the toolbar, so the App Manager and the buttons cannot be
  reached there; apps set to open at startup still open, with their title
  bars hidden if you chose that on this device beforehand.
- **A hidden title bar fades rather than disappears**: the chartplotter
  always keeps a way to bring it back and to close the window.
- **"Remember last" is per device**; two chartplotter tabs in the same
  browser share it.
- **A chartplotter shown inside another page** (for example a KIP dashboard
  that embeds Freeboard-SK) opens no apps at startup, so an app that embeds
  the chartplotter cannot open itself again inside it.

## Credits

The floating app window idea and its frame come from Karl-Erik Gustafsson's
"PiP App" proposal for Freeboard-SK.

## License

MIT
