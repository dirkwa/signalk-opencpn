/**
 * Discovering charts published by signalk-charts-provider-simple.
 *
 * That plugin stores charts as MBTiles, which OpenCPN has read natively since
 * 5.0 — so the same directory serves Freeboard-SK and OpenCPN with no
 * conversion. Its location is a user setting (`chartPath`), not a fixed path,
 * so it is read from the provider's own saved options rather than guessed.
 */

export const CHARTS_PROVIDER_ID = 'signalk-charts-provider-simple'
export const CHARTS_MOUNT = '/charts'

/** The slice of Signal K's app object this module needs. */
export interface PluginOptionsReader {
  getPluginOptions?: (id: string) => unknown
}

/**
 * The charts directory as the SIGNAL K process sees it, or null when the
 * provider is not installed or has no path configured.
 *
 * The returned path still has to be translated for the container runtime —
 * when Signal K is itself containerized this is a path inside its namespace,
 * which the host daemon cannot see. Callers pass it through `resolveMount()`.
 */
export function findChartsPath(app: PluginOptionsReader): string | null {
  let options: unknown
  try {
    options = app.getPluginOptions?.(CHARTS_PROVIDER_ID)
  } catch {
    // Provider absent, or Signal K too old to expose the reader: not an error,
    // charts are optional.
    return null
  }

  const configuration = (options as { configuration?: { chartPath?: unknown } } | undefined)
    ?.configuration
  const chartPath = configuration?.chartPath
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
