import { describe, expect, it } from 'vitest'
import { SCHEMA_DEFAULTS, type Config } from '../src/config/schema.js'
import { IMAGE, OPENCPN_DATA_PATH, buildContainerConfig } from '../src/container.js'
import type { GpuResult } from '../src/gpu.js'

const NO_GPU: GpuResult = { available: false, groups: [] }
const GPU: GpuResult = { available: true, groups: ['video', 'render'] }
const HOST_DATA = '/home/dirk/.signalk/plugin-config-data/signalk-opencpn'

const cfg = (over: Partial<Config> = {}): Config => ({ ...SCHEMA_DEFAULTS, ...over })

describe('buildContainerConfig', () => {
  it('uses host networking and publishes no ports', () => {
    const c = buildContainerConfig(cfg(), NO_GPU, 'x86', HOST_DATA)
    expect(c.networkMode).toBe('host')
    // ports are ignored under host networking; setting them would be misleading
    expect(c.ports).toBeUndefined()
    expect(c.signalkAccessiblePorts).toBeUndefined()
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
