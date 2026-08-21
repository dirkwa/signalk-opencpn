# signalk-opencpn

Run [OpenCPN](https://opencpn.org/) on your Signal K server and use it from any
browser on the boat — laptop, tablet or phone, with nothing to install on the
client.

This plugin is a thin shim around the
[`npgause/opencpn-kiosk`](https://hub.docker.com/r/npgause/opencpn-kiosk)
container image, which runs OpenCPN and streams its display over
[Xpra](https://xpra.org/)'s HTML5 client. Signal K pulls, configures, starts and
updates the container; OpenCPN itself is unmodified.

## Features

- **One-click launch** — an **OpenCPN** tile appears in Signal K's _Webapps_
  list and opens the chart plotter in a new tab.
- **Right image, automatically** — the upstream image ships architecture-specific
  tags (`x86`, `pi`) and no `latest`; the plugin picks the correct one for your
  machine.
- **GPU when you have one** — `/dev/dri` is detected at startup and passed
  through with the correct device groups, falling back to CPU rendering when
  there is no GPU.
- **Finds your instruments** — the container runs with host networking, so
  OpenCPN can discover NMEA sources and the Signal K server over mDNS/multicast.
- **Settings survive** — charts, routes and waypoints persist in the plugin's
  data directory across restarts and image updates.

## Requirements

- Signal K server ≥ 2.31.0, Node ≥ 22
- The [`signalk-container`](https://www.npmjs.com/package/signalk-container)
  plugin, installed and enabled (it provides the container runtime integration)
- Podman or Docker on the host

## Install

Install **OpenCPN** from the Signal K App Store, enable it, and open the
**OpenCPN** entry in _Webapps_. The first start pulls roughly 400 MB, so give it
a few minutes on a slow connection — the plugin status line reports progress.

## Configuration

The source of truth is [`src/config/schema.ts`](src/config/schema.ts).

| Setting      | Default | Meaning                                                                                              |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| Web UI port  | `14500` | Port OpenCPN's web interface listens on. Host networking means this is the real port on the machine. |
| Image tag    | `auto`  | `auto` selects `x86` or `pi` from your CPU. Set an explicit tag to pin one.                          |
| Memory limit | `2g`    | Hard cgroup cap for OpenCPN, Xpra and chart rendering. Empty means unlimited.                        |

## How it works

```
Browser ──► Signal K :3000 /signalk-opencpn/  ──► redirect
                                                    │
Browser ─────────── WebSocket ─────────────────────►┴─ Xpra :14500 ─► OpenCPN
```

The plugin serves only a small landing page and a JSON status endpoint. The
chart display itself is a direct connection from your browser to the container's
Xpra port — the plugin is not in that data path, which is what keeps the remote
display fast and its WebSocket stable.

## Security

⚠️ **Port 14500 is not protected by Signal K authentication.** Anyone who can
reach that port on your network gets an OpenCPN session. This matches how the
upstream image is normally run and is reasonable on a boat LAN, but do not
expose the port to the internet. If you need authenticated access, reach your
boat network over a VPN (for example
[signalk-tailscale](https://www.npmjs.com/package/signalk-tailscale)).

## License

Source-available, no redistribution — see [LICENSE.md](LICENSE.md). Free for
personal use aboard your own vessel, for your company's internal operations, and
for non-commercial education and research. You may redistribute verbatim official
releases (so registries, mirrors and your own backups are fine), but not modified
versions.

OpenCPN and the `npgause/opencpn-kiosk` image are the work of their respective
authors, are licensed separately, and are not affiliated with this plugin.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
