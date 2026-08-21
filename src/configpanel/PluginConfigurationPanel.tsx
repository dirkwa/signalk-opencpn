import React from 'react'
import {
  FieldRow,
  StatusCard,
  UpdateControls,
  panelStyles,
  useStatusPoll,
  type StateKind
} from 'signalk-container-helper/ui'

const BASE = '/plugins/signalk-opencpn'
const STATUS_URL = `${BASE}/api/status`
const CHECK_URL = `${BASE}/api/update/check`
const APPLY_URL = `${BASE}/api/update/apply`

interface StatusResponse {
  container?: { state?: string; image?: string }
  ready?: boolean
  gpu?: boolean
  url?: string | null
}

const FALLBACK: StatusResponse = { container: { state: 'unknown' } }

function stateKind(state: string | undefined): StateKind {
  if (state === 'running') return 'ok'
  if (state === 'stopped' || state === 'missing') return 'warn'
  return 'error'
}

/**
 * Config panel for the OpenCPN plugin.
 *
 * Read-only apart from the update controls and the launch link: the editable
 * settings (port, tag, memory) are rendered by Signal K's own RJSF form from
 * the TypeBox schema, so repeating them here would create a second source of
 * truth for the same values.
 */
export default function PluginConfigurationPanel(): React.ReactElement {
  const { status, loading } = useStatusPoll<StatusResponse>(STATUS_URL, {
    fallback: FALLBACK
  })

  const state = status?.container?.state
  const running = state === 'running'
  const url = status?.url

  return (
    <div style={panelStyles.root}>
      <StatusCard
        icon="CPN"
        title="OpenCPN"
        meta={loading ? 'Checking…' : (status?.container?.image ?? 'not created')}
        state={stateKind(state)}
        stateTitle={state ?? 'unknown'}
        {...(running && url ? { link: { href: url, label: 'Open OpenCPN ↗' } } : {})}
      />

      <FieldRow label="Rendering">
        <span>{status?.gpu ? 'GPU accelerated' : 'CPU (no /dev/dri found)'}</span>
      </FieldRow>

      {!running && (
        <p style={panelStyles.hint}>
          OpenCPN opens in a new browser tab once the container is running.
        </p>
      )}

      <UpdateControls checkUrl={CHECK_URL} applyUrl={APPLY_URL} updateLabel="Update image" />
    </div>
  )
}
