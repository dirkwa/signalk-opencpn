import type { IRouter, Request, Response } from 'express'
import {
  ManagedContainer,
  errMsg,
  resolveMount,
  retryForever,
  startSafely,
  waitForHttpReady,
  waitForContainerManager
} from 'signalk-container-helper'
import { resolveTag } from './arch.js'
import { ConfigSchema, SCHEMA_DEFAULTS, type Config } from './config/schema.js'
import { CONTAINER_NAME, IMAGE, OPENCPN_DATA_PATH, buildContainerConfig } from './container.js'
import { CHARTS_MOUNT, findChartsPath } from './charts.js'
import { detectGpu, type GpuResult } from './gpu.js'
import { setAuthTokenInConf } from './opencpn-conf.js'
import { ensureDeviceToken } from './signalk-token.js'
import { resolveGuiUrl } from './gui-url.js'
import type { OpenCpnApp, Plugin } from './types.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const PLUGIN_ID = 'signalk-opencpn'

export default function (app: OpenCpnApp): Plugin {
  let settings: Config = { ...SCHEMA_DEFAULTS }
  let gpu: GpuResult = { available: false, groups: [] }
  let dataPath: string | null = null
  let chartsPath: string | undefined

  // Signal K may call registerWithRouter() before start(), so the container
  // object has to exist from module-factory time, not from start().
  //
  // buildConfig closes over `settings`/`gpu`/`dataPath` rather than taking
  // them as arguments because ManagedContainer re-invokes it on every
  // start/update; they are all resolved before the first start() call.
  const container = new ManagedContainer({
    app,
    pluginId: PLUGIN_ID,
    name: CONTAINER_NAME,
    image: IMAGE,
    buildConfig: (tag) => buildContainerConfig(settings, gpu, tag, dataPath ?? '', chartsPath),
    defaultTag: SCHEMA_DEFAULTS.imageTag,
    resolveTag: (requested) => resolveTag(requested)
    // No `readiness` here on purpose. ManagedContainer's readiness probe first
    // calls resolveAddress(), which discovers the host address by inspecting
    // published port bindings — and `networkMode: 'host'` never creates any, so
    // it fails with "Declare the port in signalkAccessiblePorts". Under host
    // networking the address is not a discovery problem at all: the container
    // shares the host's stack, so it is reachable on loopback at the very port
    // we configured. We probe that ourselves in waitForXpra() below.
  })

  /**
   * Wait for Xpra to answer. Replaces ManagedContainer's readiness probe (see
   * the note on the constructor above).
   *
   * "Container running" is not "Xpra accepting connections": the image brings
   * up an Xvfb display before it binds, so the port is refused for a few
   * seconds after the container reports running.
   *
   * The OpenCPN container uses host networking, so it listens on the host's
   * loopback. That is reachable from here when Signal K runs on the host, or
   * in a container that also uses host networking — the deployments this
   * plugin targets. A bridge-networked Signal K has its own loopback and
   * cannot see it; readiness then times out and the retry loop reports it
   * rather than the plugin claiming to be running when it is not.
   */
  async function waitForXpra(signal: AbortSignal): Promise<void> {
    await waitForHttpReady(`http://127.0.0.1:${String(settings.port)}/`, {
      maxMs: 60_000,
      signal
    })
  }

  /**
   * Persist settings, logging rather than swallowing a failure — a silent loss
   * here means the resolved tag is recomputed on every restart, and after an
   * update the requested tag reverts, so auto-tracking quietly stops.
   */
  function saveSettings(): void {
    app.savePluginOptions(settings, (err?: unknown) => {
      if (err) app.error?.(`Failed to save plugin options: ${errMsg(err)}`)
    })
  }

  /**
   * Get OpenCPN a Signal K token and write it into its config.
   *
   * Runs on every start so a hand-broken or stale opencpn.conf repairs itself,
   * but only ISSUES a token when none has ever been held: if the device has
   * been deleted from Signal K, that is a revocation, and quietly minting a
   * replacement would undo it.
   */
  async function provisionToken(gen: number): Promise<void> {
    if (!settings.provisionSignalKToken) return
    // Checked before starting as well as after: ensureDeviceToken takes no
    // AbortSignal, so once it is in flight it runs to completion. Not starting
    // is the only way a retired lifecycle avoids registering a device at all.
    if (gen !== generation) return

    const strategy = app.securityStrategy
    const outcome = await ensureDeviceToken(strategy, settings.signalKToken)
    // A retired lifecycle must not persist settings or touch opencpn.conf.
    if (gen !== generation) return

    switch (outcome.kind) {
      case 'not-needed':
        return
      case 'revoked':
        app.error?.(
          'Signal K access for OpenCPN was revoked — not re-creating it. ' +
            'Clear the stored token in the plugin settings to issue a new one.'
        )
        return
      case 'failed':
        app.error?.(`Could not get Signal K access for OpenCPN: ${outcome.reason}`)
        return
      case 'provisioned':
        // Loud on purpose: a device was granted access without anyone approving it.
        app.debug(`Registered OpenCPN as a Signal K device (permissions: readwrite)`)
        settings.signalKToken = outcome.token
        saveSettings()
        break
      case 'existing':
        break
    }

    await writeTokenToOpenCpn(outcome.token, gen)
  }

  /** Put the token in opencpn.conf, if OpenCPN has written one yet. */
  async function writeTokenToOpenCpn(token: string, gen: number): Promise<void> {
    const confPath = path.join(app.getDataDirPath(), 'opencpn.conf')
    let conf: string
    try {
      conf = await fs.readFile(confPath, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // First run: OpenCPN has not created its config yet. It discovers
        // Signal K over mDNS and writes the connection itself; the token lands
        // on the next start, once there is a connection to attach it to.
        return
      }
      // Anything else (permissions, I/O) would otherwise look identical to a
      // first run, leaving OpenCPN unauthenticated with nothing to explain it.
      app.error?.(`Could not read OpenCPN settings: ${errMsg(err)}`)
      return
    }
    const updated = setAuthTokenInConf(conf, token)
    if (updated === null) return
    if (gen !== generation) return
    await fs.writeFile(confPath, updated, 'utf8')
    app.debug('Wrote the Signal K token into OpenCPN\u2019s connection settings')
  }

  // Guards against overlapping lifecycles: Signal K does not await start(), so
  // a quick disable/enable can leave an older async chain still running.
  let generation = 0
  let startAbort: AbortController | null = null

  async function asyncStart(gen: number, signal: AbortSignal): Promise<void> {
    const { manager, runtime } = await waitForContainerManager({
      timeoutMs: 120_000,
      signal
    })
    if (gen !== generation) return

    if (!manager) {
      app.setPluginError('signalk-container is not installed or not enabled')
      return
    }
    if (!runtime) {
      app.setPluginError('No container runtime (podman or docker) available')
      return
    }

    // Persist OpenCPN's own config/routes/waypoints in this plugin's data dir.
    // resolveMount (not signalkDataMount, which points at signalk-container's
    // OWN directory) also keeps this working when Signal K itself is
    // containerised. Use the returned containerPath, not the path we asked for.
    const mount = await resolveMount(manager, {
      hostPath: app.getDataDirPath(),
      containerPath: OPENCPN_DATA_PATH
    })
    if (gen !== generation) return
    // `source` is the host side of the bind — that is what goes into
    // ContainerConfig.volumes. (mount.containerPath is where it lands inside
    // the container, which we already know: OPENCPN_DATA_PATH.)
    dataPath = mount.source

    if (settings.shareCharts) {
      const providerPath = findChartsPath(app)
      if (providerPath) {
        // The provider's path is as SIGNAL K sees it; when Signal K is itself
        // containerized the host daemon cannot resolve it, so it goes through
        // the same translation as our own data dir.
        try {
          const chartsMount = await resolveMount(manager, {
            hostPath: providerPath,
            containerPath: CHARTS_MOUNT
          })
          if (gen !== generation) return
          chartsPath = chartsMount.source
          app.debug(`Sharing charts from ${providerPath}`)
        } catch (err) {
          // Charts are optional — a path we cannot reach must not stop OpenCPN.
          app.debug(`Charts directory unavailable: ${errMsg(err)}`)
          chartsPath = undefined
        }
      }
      if (gen !== generation) return
    }

    await provisionToken(gen)
    if (gen !== generation) return

    gpu = await detectGpu()
    if (gen !== generation) return
    app.debug(
      gpu.available
        ? `GPU detected at /dev/dri (groups: ${gpu.groups.join(', ')})`
        : 'No GPU found at /dev/dri — running with CPU rendering'
    )

    // retryForever, not a single attempt: on a boat nobody is around to
    // re-enable a plugin that lost a boot-order race. Each attempt re-runs the
    // whole bring-up because ensureRunning is idempotent.
    const tag = await retryForever(
      async () => {
        const started = await container.start(settings.imageTag, { signal })
        await waitForXpra(signal)
        return started.tag
      },
      {
        minDelayMs: 15_000,
        maxDelayMs: 120_000,
        signal,
        onAttemptFailed: (err, nextDelayMs) => {
          app.setPluginError(
            `OpenCPN failed to start: ${errMsg(err)} — retrying in ${String(
              Math.round(nextDelayMs / 1000)
            )}s`
          )
        }
      }
    )
    if (gen !== generation) return

    if (settings.resolvedImageTag !== tag) {
      settings.resolvedImageTag = tag
      saveSettings()
    }
    app.setPluginStatus(`Running (${tag}) on port ${String(settings.port)}`)
  }

  return {
    id: PLUGIN_ID,
    name: 'OpenCPN',
    description: 'Run OpenCPN in a container and use it from any browser on the boat',
    schema: () => ConfigSchema,

    // Synchronous: Signal K does not await this.
    start(options: unknown) {
      generation += 1
      const gen = generation
      startAbort?.abort()
      const abort = new AbortController()
      startAbort = abort

      settings = { ...SCHEMA_DEFAULTS, ...(options as Partial<Config>) }
      // Reset before any async work: a value from the previous lifecycle would
      // otherwise still be live while this start resolves, and buildConfig can
      // be called in between (the update routes reach it).
      chartsPath = undefined
      app.setPluginStatus('Starting OpenCPN…')
      startSafely(app, () => asyncStart(gen, abort.signal))
    },

    async stop() {
      generation += 1
      // Abort BEFORE awaiting: the retryForever loop in asyncStart would
      // otherwise queue another attempt behind the stop and resurrect the
      // container.
      startAbort?.abort()
      startAbort = null
      await container.stop()
      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router: IRouter) {
      router.get('/api/status', (req: Request, res: Response) => {
        void (async () => {
          const info = await container.getInfo()
          res.json({
            container: { state: info.state, image: info.image },
            ready: info.state === 'running',
            gpu: gpu.available,
            url: resolveGuiUrl({ get: (n) => req.get(n) ?? undefined }, settings.port)
          })
        })()
      })

      container.registerUpdateRoutes(router, {
        onApplied: (requestedTag, resolvedTag) => {
          // Persist what the USER asked for ("auto"), not what it resolved to,
          // or the next update silently stops tracking the architecture.
          settings.imageTag = requestedTag
          settings.resolvedImageTag = resolvedTag
          saveSettings()
        }
      })
    }
  }
}
