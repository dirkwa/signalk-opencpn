/**
 * Editing OpenCPN's `opencpn.conf`.
 *
 * The Signal K connection lives in `[Settings/NMEADataSource]` as
 * `DataConnections=`, a semicolon-delimited POSITIONAL string. Field order is
 * fixed by OpenCPN's own parser (model/src/conn_params.cpp, the
 * ConnectionParams constructor tokenising on ';'):
 *
 *   [0] Type          [1] NetProtocol   [2] NetworkAddress [3] NetworkPort
 *   [4] Protocol      [5] Port          [6] Baudrate       [7] ChecksumCheck
 *   [8] IOSelect      [9] InputSentenceListType   [10] InputSentenceList
 *   [11] OutputSentenceListType [12] OutputSentenceList    [13] Priority
 *   [14] Garmin       [15] GarminUpload [16] FurunoGP3X    [17] bEnabled
 *   [18] UserComment  [19] AutoSKDiscover [20] socketCAN_port
 *   [21] NoDataReconnect [22] DisableEcho [23] AuthToken
 *
 * Only [23] is ever written here. Because the format carries no field names,
 * a row is edited only when it matches the shape we expect exactly — right
 * field count, and the SignalK protocol marker. Anything else is left alone:
 * a wrong positional write would corrupt a working connection silently.
 */

/** Number of fields OpenCPN writes; anything else is a layout we don't know. */
export const DATA_CONNECTION_FIELDS = 24
/** Index of AuthToken. */
export const AUTH_TOKEN_INDEX = 23
/** Index of Protocol; `2` is Signal K. */
const PROTOCOL_INDEX = 4
const PROTOCOL_SIGNALK = '2'
/** Index of NetworkAddress, used to tell our own server from a remote one. */
const ADDRESS_INDEX = 2

/**
 * Put `token` in the AuthToken field of every Signal K connection in a
 * `DataConnections=` value.
 *
 * @returns the rewritten value, or null when nothing was eligible to change —
 * so a caller can tell "already correct" and "unrecognised layout" from a
 * successful edit and avoid rewriting the file for no reason.
 */
export function setAuthTokenInDataConnections(
  value: string,
  token: string,
  addresses: readonly string[] = []
): string | null {
  // OpenCPN separates multiple connections with '|'.
  const rows = value.split('|')
  const eligible = rows.filter(isSignalKRow)

  // The token belongs to THIS server. Writing it into a connection pointing
  // somewhere else would hand our device credential to a third-party server,
  // so a row is only touched when its address is one of ours — or, when we
  // could not determine our own addresses, when there is exactly one Signal K
  // connection and it is therefore unambiguous.
  const matches = (row: string): boolean => {
    const address = row.split(';')[ADDRESS_INDEX]?.trim() ?? ''
    if (addresses.length > 0) return addresses.includes(address)
    return eligible.length === 1
  }

  const next = rows.map((row) => (isSignalKRow(row) && matches(row) ? rewriteRow(row, token) : row))
  return next.some((row, i) => row !== rows[i]) ? next.join('|') : null
}

/** Is this row a Signal K connection in the layout we know? */
function isSignalKRow(row: string): boolean {
  if (row.trim() === '') return false
  const fields = row.split(';')
  return fields.length === DATA_CONNECTION_FIELDS && fields[PROTOCOL_INDEX] === PROTOCOL_SIGNALK
}

/** One connection row, with the token set — or unchanged when not ours to edit. */
function rewriteRow(row: string, token: string): string {
  if (row.trim() === '') return row
  const fields = row.split(';')
  // Refuse anything that is not the layout documented above.
  if (fields.length !== DATA_CONNECTION_FIELDS) return row
  if (fields[PROTOCOL_INDEX] !== PROTOCOL_SIGNALK) return row
  if (fields[AUTH_TOKEN_INDEX] === token) return row
  fields[AUTH_TOKEN_INDEX] = token
  return fields.join(';')
}

/**
 * Rewrite the `DataConnections=` line of an opencpn.conf, returning the new
 * file contents or null when nothing changed.
 *
 * Operates on the raw text rather than a parsed INI: OpenCPN owns this file,
 * and a round-trip through a generic INI writer would reorder keys and drop
 * the comments and formatting it wrote.
 */
export function setAuthTokenInConf(
  conf: string,
  token: string,
  addresses: readonly string[] = []
): string | null {
  const lines = conf.split('\n')
  const next = lines.map((line) => {
    if (!line.startsWith('DataConnections=')) return line
    const updated = setAuthTokenInDataConnections(
      line.slice('DataConnections='.length),
      token,
      addresses
    )
    return updated === null ? line : `DataConnections=${updated}`
  })

  return next.some((line, i) => line !== lines[i]) ? next.join('\n') : null
}
