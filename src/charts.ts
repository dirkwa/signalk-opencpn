/**
 * Discovering charts published by signalk-charts-provider-simple.
 *
 * That plugin stores charts as MBTiles, which OpenCPN has read natively since
 * 5.0 — so the same directory serves Freeboard-SK and OpenCPN with no
 * conversion. Its location is a user setting (`chartPath`), not a fixed path.
 *
 * Read from the provider's config file rather than through the app object:
 * `app.getPluginOptions(id)` exists on the server's app but NOT on the shallow
 * copy each plugin receives (verified at runtime — it is undefined there), and
 * `app.readPluginOptions()` takes no argument and returns the calling plugin's
 * own options. Neither can see another plugin's configuration, so the file is
 * the only route.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const CHARTS_PROVIDER_ID = 'signalk-charts-provider-simple'
export const CHARTS_MOUNT = '/charts'
/** Signal K keeps every plugin's saved options here, one JSON file each. */
const PLUGIN_CONFIG_DIR = 'plugin-config-data'

/** The slice of Signal K's app object this module needs. */
export interface ChartsApp {
  config?: { configPath?: string }
}

/**
 * The charts directory as the SIGNAL K process sees it, or null when the
 * provider is absent, disabled, or has no usable path configured.
 *
 * The returned path still has to be translated for the container runtime —
 * when Signal K is itself containerized this is a path inside its namespace,
 * which the host daemon cannot see. Callers pass it through `resolveMount()`.
 */
export async function findChartsPath(app: ChartsApp): Promise<string | null> {
  const configPath = app.config?.configPath
  if (!configPath) return null

  const file = path.join(configPath, PLUGIN_CONFIG_DIR, `${CHARTS_PROVIDER_ID}.json`)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    // Provider not installed, or never configured: charts are optional.
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const record = parsed as { enabled?: unknown; configuration?: { chartPath?: unknown } }
  // A disabled provider is not serving charts; sharing its directory anyway
  // would be surprising.
  if (record.enabled === false) return null

  const chartPath = record.configuration?.chartPath
  if (typeof chartPath !== 'string') return null

  const trimmed = chartPath.trim()
  // Must be absolute: a relative path would resolve against whatever the
  // runtime's working directory happens to be.
  if (!trimmed.startsWith('/')) return null
  // Refuse the host root. A misconfigured or empty-ish chartPath of "/" would
  // otherwise bind the entire host filesystem into the container.
  if (trimmed.replace(/\/+$/, '') === '') return null
  return trimmed
}
