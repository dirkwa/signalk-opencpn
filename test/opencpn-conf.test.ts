import { describe, expect, it } from 'vitest'
import {
  AUTH_TOKEN_INDEX,
  DATA_CONNECTION_FIELDS,
  setAuthTokenInConf,
  setAuthTokenInDataConnections
} from '../src/opencpn-conf.js'

// The exact layout OpenCPN writes — 24 fields, Signal K protocol (index 4 =
// '2'), empty AuthToken at index 23 — with the host details replaced by the
// RFC 5737 documentation address so no real installation is described here.
const REAL_ROW =
  '1;3;192.0.2.10;80;2;;4800;1;0;0;;0;;0;0;1;0;1;SignalK: vessel (192.0.2.10 port 80);0;;0;0;'

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test.sig'

describe('setAuthTokenInDataConnections', () => {
  it('writes the token into the AuthToken field', () => {
    const out = setAuthTokenInDataConnections(REAL_ROW, TOKEN)
    expect(out).not.toBeNull()
    expect(out?.split(';')[AUTH_TOKEN_INDEX]).toBe(TOKEN)
  })

  it('leaves every other field untouched', () => {
    const before = REAL_ROW.split(';')
    const after = setAuthTokenInDataConnections(REAL_ROW, TOKEN)?.split(';') ?? []
    expect(after).toHaveLength(DATA_CONNECTION_FIELDS)
    for (let i = 0; i < DATA_CONNECTION_FIELDS; i++) {
      if (i !== AUTH_TOKEN_INDEX) expect(after[i]).toBe(before[i])
    }
  })

  it('preserves the user comment, which sits next to the token', () => {
    const after = setAuthTokenInDataConnections(REAL_ROW, TOKEN)?.split(';') ?? []
    expect(after[18]).toBe('SignalK: vessel (192.0.2.10 port 80)')
  })

  it('returns null when the token is already correct, so the file is not rewritten', () => {
    const once = setAuthTokenInDataConnections(REAL_ROW, TOKEN)
    expect(setAuthTokenInDataConnections(once ?? '', TOKEN)).toBeNull()
  })

  it('refuses a row with an unexpected field count', () => {
    // A layout we do not recognise: writing by index could corrupt it.
    expect(setAuthTokenInDataConnections('1;3;host;80;2', TOKEN)).toBeNull()
  })

  it('leaves non-Signal-K connections alone', () => {
    // Same field count, protocol 0 (NMEA0183) — not ours to touch.
    const nmea = REAL_ROW.split(';')
    nmea[4] = '0'
    expect(setAuthTokenInDataConnections(nmea.join(';'), TOKEN)).toBeNull()
  })

  it('updates only the Signal K row when several connections exist', () => {
    const nmea = REAL_ROW.split(';')
    nmea[4] = '0'
    const both = `${nmea.join(';')}|${REAL_ROW}`
    const out = setAuthTokenInDataConnections(both, TOKEN)?.split('|') ?? []
    expect(out[0]).toBe(nmea.join(';'))
    expect(out[1]?.split(';')[AUTH_TOKEN_INDEX]).toBe(TOKEN)
  })

  // The token identifies THIS server's device. Writing it into a connection
  // pointing elsewhere would hand our credential to a third-party server.
  it('does not touch a Signal K connection to another server', () => {
    const remote = REAL_ROW.split(';')
    remote[2] = '198.51.100.7'
    const both = `${REAL_ROW}|${remote.join(';')}`
    const out = setAuthTokenInDataConnections(both, TOKEN, ['192.0.2.10'])?.split('|') ?? []
    expect(out[0]?.split(';')[AUTH_TOKEN_INDEX]).toBe(TOKEN)
    expect(out[1]?.split(';')[AUTH_TOKEN_INDEX]).toBe('')
  })

  it('refuses to guess when several Signal K connections exist and none is known ours', () => {
    const remote = REAL_ROW.split(';')
    remote[2] = '198.51.100.7'
    const both = `${REAL_ROW}|${remote.join(';')}`
    // No addresses supplied and more than one candidate: ambiguous, so nothing.
    expect(setAuthTokenInDataConnections(both, TOKEN)).toBeNull()
  })

  it('still writes the only Signal K connection when addresses are unknown', () => {
    const out = setAuthTokenInDataConnections(REAL_ROW, TOKEN)
    expect(out?.split(';')[AUTH_TOKEN_INDEX]).toBe(TOKEN)
  })

  it('replaces an existing stale token', () => {
    const stale = REAL_ROW.split(';')
    stale[AUTH_TOKEN_INDEX] = 'old-token'
    const out = setAuthTokenInDataConnections(stale.join(';'), TOKEN)
    expect(out?.split(';')[AUTH_TOKEN_INDEX]).toBe(TOKEN)
  })
})

describe('setAuthTokenInConf', () => {
  const conf = [
    '[Settings/NMEADataSource]',
    `DataConnections=${REAL_ROW}`,
    '[Settings/Audio]',
    'X=1'
  ].join('\n')

  it('rewrites only the DataConnections line', () => {
    const out = setAuthTokenInConf(conf, TOKEN)?.split('\n') ?? []
    expect(out[0]).toBe('[Settings/NMEADataSource]')
    expect(out[2]).toBe('[Settings/Audio]')
    expect(out[3]).toBe('X=1')
    expect(out[1]).toContain(TOKEN)
  })

  it('returns null when there is nothing to change', () => {
    expect(setAuthTokenInConf('[Settings/Audio]\nX=1', TOKEN)).toBeNull()
  })
})
