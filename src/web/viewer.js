// Viewer (REQUIREMENTS.md §9.1): the page shown in every window. Embeds the
// page in context.params.url in one full-size iframe; the host owns the
// window's title bar and close control.

import { connectExtension } from 'signalk-plotterext-bus/extension'
import validate from '../../plugin/validate.js'

const { isAllowedUrl } = validate

/** Fill `root` with the app frame for `url`, or a message if it is not allowed. */
export function renderViewer(root, url, doc = document) {
  root.textContent = ''
  if (!isAllowedUrl(url)) {
    const p = doc.createElement('p')
    p.className = 'message'
    p.textContent = 'This app has no valid address. Check it in Companion Apps.'
    root.appendChild(p)
    return null
  }
  const frame = doc.createElement('iframe')
  frame.className = 'app-frame'
  frame.title = 'App'
  frame.src = url
  root.appendChild(frame)
  return frame
}

if (typeof document !== 'undefined' && document.getElementById('root')) {
  connectExtension()
    .then((client) => renderViewer(document.getElementById('root'), client.context.params?.url))
    .catch((err) => {
      console.warn('Companion Apps viewer could not connect:', err)
      renderViewer(document.getElementById('root'), null)
    })
}
