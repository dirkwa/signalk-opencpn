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
import { detectGpu, type GpuResult } from './gpu.js'
import { resolveGuiUrl } from './gui-url.js'
import type { OpenCpnApp, Plugin } from './types.js'

const PLUGIN_ID = 'signalk-opencpn'

export default function (app: OpenCpnApp): Plugin {
  let settings: Config = { ...SCHEMA_DEFAULTS }
  let gpu: GpuResult = { available: false, groups: [] }
  let dataPath: string | null = null

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
    buildConfig: (tag) => buildContainerConfig(settings, gpu, tag, dataPath ?? ''),
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
   * Wait for Xpra to answer on loopback. Replaces ManagedContainer's readiness
   * probe (see the note on the constructor above).
   *
   * "Container running" is not "Xpra accepting connections": the image starts
   * an Xvfb display and OpenCPN before it binds, so the port is refused for a
   * few seconds after the container reports running.
   */
  async function waitForXpra(signal: AbortSignal): Promise<void> {
    await waitForHttpReady(`http://127.0.0.1:${String(settings.port)}/`, {
      maxMs: 60_000,
      signal
    })
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
      app.savePluginOptions(settings, () => {})
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
      app.setPluginStatus('Starting OpenCPN…')
      startSafely(app, () => asyncStart(gen, abort.signal))
    },

    async stop() {
      generation += 1
      // Abort BEFORE awaiting: readinessRetry would otherwise queue another
      // attempt behind the stop and resurrect the container.
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
          app.savePluginOptions(settings, () => {})
        }
      })
    }
  }
}
