import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHARTS_PROVIDER_ID, findChartsPath } from '../src/charts.js'

let configPath: string

beforeEach(async () => {
  configPath = await fs.mkdtemp(path.join(os.tmpdir(), 'opencpn-charts-'))
  await fs.mkdir(path.join(configPath, 'plugin-config-data'), { recursive: true })
})

afterEach(async () => {
  await fs.rm(configPath, { recursive: true, force: true })
})

async function writeProviderConfig(body: unknown): Promise<void> {
  await fs.writeFile(
    path.join(configPath, 'plugin-config-data', `${CHARTS_PROVIDER_ID}.json`),
    JSON.stringify(body)
  )
}

const app = () => ({ config: { configPath } })

describe('findChartsPath', () => {
  it('reads chartPath from the provider config file', async () => {
    // Real shape from a live install, with the path rewritten to avoid the
    // /home/<user>/ literal Signal K's plugin-CI rejects.
    const chartPath = '/var/lib/signalk/charts-simple'
    await writeProviderConfig({ enabled: true, configuration: { chartPath } })
    expect(await findChartsPath(app())).toBe(chartPath)
  })

  it('returns null when the provider is not installed', async () => {
    expect(await findChartsPath(app())).toBeNull()
  })

  it('returns null when Signal K exposes no configPath', async () => {
    expect(await findChartsPath({})).toBeNull()
  })

  it('ignores a disabled provider, which is not serving charts', async () => {
    await writeProviderConfig({ enabled: false, configuration: { chartPath: '/var/charts' } })
    expect(await findChartsPath(app())).toBeNull()
  })

  it('returns null when no chartPath is configured', async () => {
    await writeProviderConfig({ enabled: true, configuration: {} })
    expect(await findChartsPath(app())).toBeNull()
  })

  it('rejects the host root, which would bind the whole filesystem in', async () => {
    await writeProviderConfig({ configuration: { chartPath: '/' } })
    expect(await findChartsPath(app())).toBeNull()
    await writeProviderConfig({ configuration: { chartPath: '///' } })
    expect(await findChartsPath(app())).toBeNull()
  })

  it('rejects a relative path, which would resolve against an arbitrary cwd', async () => {
    await writeProviderConfig({ configuration: { chartPath: 'charts' } })
    expect(await findChartsPath(app())).toBeNull()
  })

  it('ignores a non-string chartPath', async () => {
    await writeProviderConfig({ configuration: { chartPath: 42 } })
    expect(await findChartsPath(app())).toBeNull()
  })

  it('survives a config file holding a non-object value', async () => {
    // JSON.parse('null') succeeds, so this reaches the property access.
    await fs.writeFile(
      path.join(configPath, 'plugin-config-data', `${CHARTS_PROVIDER_ID}.json`),
      'null'
    )
    expect(await findChartsPath(app())).toBeNull()
  })

  it('survives a corrupt config file', async () => {
    await fs.writeFile(
      path.join(configPath, 'plugin-config-data', `${CHARTS_PROVIDER_ID}.json`),
      '{not json'
    )
    expect(await findChartsPath(app())).toBeNull()
  })
})
