import { describe, expect, it } from 'vitest'
import { SCHEMA_DEFAULTS, type Config } from '../src/config/schema.js'
import { IMAGE, OPENCPN_DATA_PATH, buildContainerConfig } from '../src/container.js'
import type { GpuResult } from '../src/gpu.js'

const NO_GPU: GpuResult = { available: false, groups: [] }
const GPU: GpuResult = { available: true, groups: ['video', 'render'] }
// Not under /home/<user>/: Signal K's plugin-CI rejects such literals in source.
const HOST_DATA = '/var/lib/signalk/plugin-config-data/signalk-opencpn'

const cfg = (over: Partial<Config> = {}): Config => ({ ...SCHEMA_DEFAULTS, ...over })

describe('buildContainerConfig', () => {
  it('uses host networking and publishes no ports', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.networkMode).toBe('host')
    // ports are ignored under host networking; setting them would be misleading
    expect(c.ports).toBeUndefined()
  })

  // Regression: signalkAccessiblePorts exists so signalk-container can wire
  // networking and so ManagedContainer.resolveAddress() can find a published
  // binding. Host networking creates no bindings, so resolveAddress always
  // returns null and the helper's readiness probe dies with "Could not resolve
  // address ... Declare the port in signalkAccessiblePorts". Declaring it would
  // not help — the plugin probes 127.0.0.1:<port> itself instead, so the field
  // must stay absent rather than be added in response to that error message.
  it('does not declare signalkAccessiblePorts under host networking', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.signalkAccessiblePorts).toBeUndefined()
    expect(c.networkMode).toBe('host')
  })

  it('passes the configured port to Xpra', () => {
    const c = buildContainerConfig(cfg({ port: 15000 }), NO_GPU, 'x86', HOST_DATA)
    expect(c.env?.XPRA_BIND_PORT).toBe('15000')
  })

  it("mounts the host data dir at OpenCPN's config path", () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.volumes).toEqual({ [OPENCPN_DATA_PATH]: HOST_DATA })
  })

  it('omits device passthrough and disables GPU env when there is no GPU', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.devices).toBeUndefined()
    expect(c.groupAdd).toBeUndefined()
    expect(c.env?.OPENCPN_USE_GPU).toBe('false')
    expect(c.env?.XPRA_USE_GPU).toBe('false')
  })

  it('passes /dev/dri in hot-plug directory form with the detected groups', () => {
    const c = buildContainerConfig(cfg(), GPU, 'x86', HOST_DATA)
    // Directory, not a node path: this selects the helper's hot-plug mode.
    expect(c.devices).toEqual(['/dev/dri'])
    expect(c.groupAdd).toEqual(['video', 'render'])
    expect(c.env?.OPENCPN_USE_GPU).toBe('true')
  })

  it("never hardcodes upstream's render gid 993", () => {
    const c = buildContainerConfig(cfg(), GPU, 'x86', HOST_DATA)
    expect(c.groupAdd).not.toContain(993)
    expect(c.groupAdd).not.toContain('993')
  })

  // Regression: the image declares USER ubuntu (1000). Without this mapping the
  // config bind mount is not writable by the container user — on rootless
  // podman the Signal K user maps to container uid 0 — so OpenCPN cannot save
  // its first-run config, exits after a few seconds, and --exit-with-children
  // takes the container down. Symptom: "runs 8s then stops", clean exit 0.
  // Reachable in practice: POST /api/update/apply calls buildConfig via
  // ManagedContainer.applyUpdate, and registerWithRouter runs before start()
  // has resolved the mount. Building anyway would mount an empty source, so
  // OpenCPN would silently lose routes and waypoints on the recreate.
  it('refuses to build a config before the data path is resolved', () => {
    expect(() => buildContainerConfig(cfg(), NO_GPU, 'x86', '')).toThrow(/not resolved yet/)
  })

  it('mounts the shared charts directory when one is given', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA, '/var/charts')
    // ifMissing 'skip': an unplugged USB or unmounted NFS share must not stop
    // OpenCPN from starting, it just means those charts are absent.
    expect(c.volumes?.['/charts']).toEqual({ source: '/var/charts', ifMissing: 'skip' })
  })

  it('omits the charts mount when no directory is shared', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.volumes?.['/charts']).toBeUndefined()
    expect(Object.keys(c.volumes ?? {})).toHaveLength(1)
  })

  it('maps bind-mount ownership to the image user', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.user).toEqual({ inImageUid: 1000, inImageGid: 1000 })
  })

  it('applies the memory limit, and omits it entirely when blank', () => {
    expect(buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA).resources).toEqual({
      memory: '2g'
    })
    // '' means unlimited — the key must be absent, not an empty string.
    expect(
      buildContainerConfig(cfg({ memoryLimit: '' }), NO_GPU, 'x86', HOST_DATA).resources
    ).toBeUndefined()
  })

  it('uses the tag it is given', () => {
    expect(buildContainerConfig(cfg(), NO_GPU, 'pi', HOST_DATA).tag).toBe('pi')
    expect(buildContainerConfig(cfg(), NO_GPU, 'pi', HOST_DATA).image).toBe(IMAGE)
  })

  // The important one: signalk-container recreates on any diff in image, tag,
  // env, volumes, networkMode, devices or groupAdd. Unstable output here means
  // an endless pull/recreate loop on every ensureRunning.
  it('is byte-identical across repeated calls with the same inputs', () => {
    const a = buildContainerConfig(cfg(), GPU, 'x86', HOST_DATA)
    const b = buildContainerConfig(cfg(), GPU, 'x86', HOST_DATA)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('is pure — it does not mutate the settings it is given', () => {
    const settings = cfg()
    const snapshot = JSON.stringify(settings)
    buildContainerConfig(settings, GPU, 'x86', HOST_DATA)
    expect(JSON.stringify(settings)).toBe(snapshot)
  })
})
