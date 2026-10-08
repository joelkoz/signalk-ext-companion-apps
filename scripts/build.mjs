// Build the web pages into public/, which the plugin serves as a top-level
// static route at /plotterext/signalk-ext-companion-apps/. Logs go to stderr.

import { build } from 'esbuild'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUTTON_ICONS, RETIRED_ICONS, UI_ICONS } from '../src/web/icon-list.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pub = join(root, 'public')
const require = createRequire(import.meta.url)

rmSync(pub, { recursive: true, force: true })
mkdirSync(join(pub, 'js'), { recursive: true })

// `icons:svg` — { [name]: '<svg …>' } for every icon the launcher draws.
const iconDir = dirname(require.resolve('@material-design-icons/svg/filled/apps.svg'))
const svgOf = (name) =>
  readFileSync(join(iconDir, `${name}.svg`), 'utf8')
    .trim()
    .replace(' width="24" height="24"', ' aria-hidden="true" focusable="false"')
const names = [...BUTTON_ICONS, ...RETIRED_ICONS].map(([n]) => n).concat(UI_ICONS)
const svgs = Object.fromEntries(names.map((n) => [n, svgOf(n)]))
const iconsPlugin = {
  name: 'icons',
  setup(b) {
    b.onResolve({ filter: /^icons:svg$/ }, () => ({ path: 'icons:svg', namespace: 'icons' }))
    b.onLoad({ filter: /.*/, namespace: 'icons' }, () => ({
      contents: `export default ${JSON.stringify(svgs)}`,
      loader: 'js'
    }))
  }
}

await build({
  entryPoints: ['runtime', 'sidepanel', 'viewer'].map((n) => join(root, `src/web/${n}.js`)),
  bundle: true,
  format: 'iife',
  outdir: join(pub, 'js'),
  sourcemap: true,
  target: ['es2020'],
  plugins: [iconsPlugin],
  logLevel: 'warning'
})

cpSync(join(root, 'src/web/companion-apps.css'), join(pub, 'companion-apps.css'))
cpSync(join(root, 'src/web/assets'), join(pub, 'assets'), { recursive: true })

const page = (name, bodyClass, title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="companion-apps.css">
</head>
<body class="${bodyClass}">
<div id="root"></div>
<script src="js/${name}.js"></script>
</body>
</html>
`

writeFileSync(join(pub, 'runtime.html'), page('runtime', 'runtime', 'Companion Apps manager'))
writeFileSync(join(pub, 'sidepanel.html'), page('sidepanel', 'sidepanel', 'Companion Apps'))
writeFileSync(join(pub, 'viewer.html'), page('viewer', 'viewer', 'App'))

console.error('public/ written')
