import { describe, expect, it } from 'vitest'
import {
  AUTH_TOKEN_INDEX,
  DATA_CONNECTION_FIELDS,
  setAuthTokenInConf,
  setAuthTokenInDataConnections
} from '../src/opencpn-conf.js'

// Dirk's real connection line, taken verbatim from a live opencpn.conf: 24
// fields, Signal K protocol (index 4 = '2'), empty AuthToken at index 23.
const REAL_ROW =
  '1;3;172.31.3.122;80;2;;4800;1;0;0;;0;;0;0;1;0;1;SignalK: vmsignalk (172.31.3.122 port 80);0;;0;0;'

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
    expect(after[18]).toBe('SignalK: vmsignalk (172.31.3.122 port 80)')
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
