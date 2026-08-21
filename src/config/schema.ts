import { Type, type Static } from 'typebox'
import { TAG_AUTO } from '../arch.js'

/** Xpra's HTML5 client port, and the image's own default. */
export const DEFAULT_PORT = 14500

/**
 * Deliberately small. House style across the Signal K plugins here is to keep
 * the RJSF form minimal and put real UI in the federated config panel.
 *
 * TypeBox v1 emits standard JSON Schema, so this object is handed to
 * `plugin.schema` as-is — there is no conversion step.
 */
export const ConfigSchema = Type.Object({
  port: Type.Number({
    default: DEFAULT_PORT,
    minimum: 1,
    maximum: 65535,
    title: 'Web UI port',
    description:
      'Port the OpenCPN web interface listens on. The container uses host networking, so this is the real port on this machine.'
  }),
  imageTag: Type.String({
    default: TAG_AUTO,
    title: 'Image tag',
    description:
      'The image ships no multi-arch manifest and no "latest": "auto" picks x86 or pi from this machine. Set an explicit tag to pin one.'
  }),
  resolvedImageTag: Type.Optional(
    Type.String({
      readOnly: true,
      title: 'Resolved image tag',
      description: 'The tag actually running. Written by the plugin.'
    })
  ),
  provisionSignalKToken: Type.Boolean({
    default: true,
    title: 'Give OpenCPN access to Signal K',
    description:
      'Registers OpenCPN as a Signal K device so it can stay connected. Without a token the server closes the connection about once a minute. Revoke it under Security → Devices; it will not be re-created.'
  }),
  signalKToken: Type.Optional(
    Type.String({
      title: 'Signal K token',
      description:
        'Issued automatically and written to OpenCPN on start. Clear this field to issue a new one — needed after revoking OpenCPN under Security → Devices, which is otherwise never undone automatically.'
    })
  ),
  signalKRequestId: Type.Optional(
    Type.String({
      readOnly: true,
      title: 'Pending access request',
      description:
        'Set while OpenCPN is waiting for approval under Security → Access Requests. Cleared once the token is issued.'
    })
  ),
  shareCharts: Type.Boolean({
    default: true,
    title: 'Share charts with Charts Provider Simple',
    description:
      'Mounts that plugin\u2019s chart directory into OpenCPN, which reads its MBTiles natively. Ignored when the plugin is not installed.'
  }),
  memoryLimit: Type.String({
    default: '2g',
    title: 'Memory limit',
    description:
      'Hard cgroup cap for OpenCPN, Xpra and chart rendering (e.g. 1g, 2g, 4g). Empty means unlimited.'
  })
})

export type Config = Static<typeof ConfigSchema>

/**
 * Signal K does NOT seed schema defaults into the runtime config — a freshly
 * enabled plugin is handed `{}` — so every default has to be repeated here and
 * merged in start().
 */
export const SCHEMA_DEFAULTS: Config = {
  port: DEFAULT_PORT,
  imageTag: TAG_AUTO,
  provisionSignalKToken: true,
  shareCharts: true,
  memoryLimit: '2g'
}
