# signalk-opencpn — working notes

## What this is

A Signal K plugin that runs the third-party `npgause/opencpn-kiosk` container
and surfaces it as an **OpenCPN** tile in the Webapps list. It is a _shim_: it
owns the container lifecycle and nothing else — no proxying, no Signal K
deltas, no chart management.

## Architecture rules

- **No proxy, by design.** OpenCPN's UI is Xpra HTML5, which is WebSocket-based.
  The webapp tile opens `http://<host>:14500` in a new tab. Consequence: that
  port carries **no Signal K authentication** — same exposure as upstream's own
  compose file. Do not "fix" this with a naive Express proxy; hop-by-hop header
  stripping kills the WebSocket. (`mayara-server-signalk-plugin` shows what a
  correct WS proxy costs if it is ever wanted.)
- **`buildContainerConfig` must stay pure and stable.** signalk-container
  recreates the container whenever image, tag, env, volumes, networkMode,
  devices or groupAdd differ. Unstable output = endless recreate loop. GPU
  detection therefore happens once in `start()` and is passed in.
- **Host networking is required**, not a preference: OpenCPN needs
  multicast/mDNS to discover NMEA sources and the Signal K server.

## Gotchas

- **Never hardcode gid 993.** Upstream's compose does; it is the render gid on
  _their_ host. `src/gpu.ts` stats the real `/dev/dri` nodes and resolves the
  owning group _names_ (the helper maps names against the host `/etc/group`).
  This dev VM has only `card0` owned by `video` (44), no `renderD128`.
- **The image has no `latest` and no multi-arch manifest** — only `x86`
  (amd64) and `pi` (arm64). `src/arch.ts` picks one from `process.arch`.
- **Signal K does not seed schema defaults.** A freshly enabled plugin gets
  `{}`; merge `SCHEMA_DEFAULTS` in `start()`.
- **`resolveMount`, not `signalkDataMount`** — the latter resolves to
  _signalk-container's_ own data dir, not this plugin's. Use the returned
  `source` as the host side of the volume.
- **`start()` is synchronous** (Signal K does not await it). The async body
  runs under `startSafely` guarded by a generation counter + AbortController;
  `stop()` aborts _before_ awaiting, or `readinessRetry` resurrects it.
- **Keep typebox out of the panel bundle** — import config types into
  `src/configpanel/` as type-only. Verified in the build check below.
- **`jsxRuntime: 'classic'`** in vite.config.ts pairs with `"jsx": "react"` in
  the panel tsconfig. The automatic runtime imports `react/jsx-runtime`, which
  is not in the `shared` scope, and yields a second React instance whose
  dispatcher is null at mount — a runtime failure with no build error.
- `public/` is build **output** (`publicDir: false`, `emptyOutDir: false`);
  `build.js` writes index.html + icon there before vite adds remoteEntry.js.

## Build, lint, test

    npm run build:all      # lint + build + test
    npm test               # vitest
    npm run build          # tsc → plugin/, then build.js + vite → public/

Sanity check after a build (both should hold):

    grep -rl typebox public/          # must find nothing
    grep -ro jsx-runtime public/      # must find nothing
