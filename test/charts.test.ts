import { describe, expect, it } from 'vitest'
import { CHARTS_PROVIDER_ID, findChartsPath } from '../src/charts.js'

const reader = (options: unknown) => ({
  getPluginOptions: (id: string) => (id === CHARTS_PROVIDER_ID ? options : undefined)
})

describe('findChartsPath', () => {
  it('reads chartPath from the provider options', () => {
    // Real shape from a live install. Written as a container-side path under
    // /var rather than the actual /home/<user>/... value, which Signal K's
    // plugin-CI rejects as a hardcoded home directory.
    const chartPath = '/var/lib/signalk/charts-simple'
    const app = reader({ configuration: { chartPath } })
    expect(findChartsPath(app)).toBe(chartPath)
  })

  it('returns null when the provider is not installed', () => {
    expect(findChartsPath({ getPluginOptions: () => undefined })).toBeNull()
  })

  it('returns null when Signal K does not expose the reader', () => {
    expect(findChartsPath({})).toBeNull()
  })

  it('returns null when no chartPath is configured', () => {
    expect(findChartsPath(reader({ configuration: {} }))).toBeNull()
  })

  it('rejects the host root, which would bind the whole filesystem in', () => {
    expect(findChartsPath(reader({ configuration: { chartPath: '/' } }))).toBeNull()
    expect(findChartsPath(reader({ configuration: { chartPath: '///' } }))).toBeNull()
  })

  it('rejects a relative path, which would resolve against an arbitrary cwd', () => {
    expect(findChartsPath(reader({ configuration: { chartPath: 'charts' } }))).toBeNull()
  })

  it('ignores a non-string chartPath', () => {
    expect(findChartsPath(reader({ configuration: { chartPath: 42 } }))).toBeNull()
  })

  it('survives a provider that throws when read', () => {
    const app = {
      getPluginOptions: () => {
        throw new Error('not installed')
      }
    }
    expect(findChartsPath(app)).toBeNull()
  })
})
