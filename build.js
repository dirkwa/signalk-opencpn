#!/usr/bin/env node
/**
 * Creates public/ with the webapp landing page and the app icon.
 * Vite then adds remoteEntry.js (the config panel) into the same directory.
 *
 * The landing page is what the "OpenCPN" tile in Signal K's Webapps list
 * opens. It immediately forwards to the container's own Xpra port, because
 * OpenCPN's UI is a WebSocket-based remote display that this plugin
 * deliberately does not proxy.
 */

import fs from 'node:fs'
import path from 'node:path'

const projectRoot = import.meta.dirname
const publicDest = path.join(projectRoot, 'public')

function main() {
  fs.rmSync(publicDest, { recursive: true, force: true })
  fs.mkdirSync(publicDest, { recursive: true })

  // Signal K resolves signalk.appIcon relative to public/, so the icon has to
  // live here in the published package.
  fs.copyFileSync(path.join(projectRoot, 'icon.svg'), path.join(publicDest, 'icon.svg'))

  // The target is resolved at runtime from /api/status rather than baked in:
  // it depends on the configured port AND on the hostname the browser used to
  // reach Signal K, which is only knowable from the request.
  fs.writeFileSync(
    path.join(publicDest, 'index.html'),
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>OpenCPN</title>
  <link rel="icon" type="image/svg+xml" href="icon.svg">
  <style>
    body { font-family: sans-serif; display: flex; justify-content: center;
           align-items: center; height: 100vh; margin: 0;
           background: #111; color: #ccc; }
    .box { text-align: center; max-width: 30rem; }
    .box img { width: 80px; margin-bottom: 16px; }
    a { color: #6ab0ff; }
  </style>
</head>
<body>
  <div class="box">
    <img src="icon.svg" alt="OpenCPN">
    <p id="msg">Opening OpenCPN…</p>
    <noscript><p>Enable JavaScript, or open the OpenCPN port on this host directly.</p></noscript>
  </div>
  <script>
    fetch('/plugins/signalk-opencpn/api/status')
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (j) {
        if (j && j.url && j.ready) { window.location.replace(j.url); return }
        var msg = document.getElementById('msg')
        if (j && j.url) {
          msg.innerHTML = 'OpenCPN is not running yet (' +
            ((j.container && j.container.state) || 'unknown') +
            ').<br><br><a href="' + j.url + '">Try opening it anyway</a>'
        } else {
          msg.textContent = 'The OpenCPN plugin is not responding. Is it enabled?'
        }
      })
      .catch(function () {
        document.getElementById('msg').textContent =
          'The OpenCPN plugin is not responding. Is it enabled?'
      })
  </script>
</body>
</html>
`
  )
  console.log('public/ ready (index.html, icon.svg)')
}

main()
