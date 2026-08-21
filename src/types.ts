import type { IRouter } from 'express'

/**
 * The slice of Signal K's `app` this plugin uses. Structurally typed rather
 * than pulled from @signalk/server-api so the plugin stays easy to unit-test
 * with a plain object — it is also a superset of the helper's AppLike.
 */
export interface OpenCpnApp {
  debug: (msg: string) => void
  error?: (msg: string) => void
  setPluginStatus: (msg: string) => void
  setPluginError: (msg: string) => void
  getDataDirPath: () => string
  savePluginOptions: (options: unknown, callback: (err?: unknown) => void) => void
}

export interface Plugin {
  id: string
  name: string
  description: string
  schema: () => unknown
  start: (options: unknown) => void
  stop: () => Promise<void>
  registerWithRouter: (router: IRouter) => void
}
