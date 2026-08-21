/**
 * Provisioning a Signal K device token for OpenCPN.
 *
 * OpenCPN speaks Signal K over a websocket and supports authentication only
 * as a pre-shared token appended to the URL (`&token=<jwt>`, from
 * `params->AuthToken` in model/src/comm_drv_signalk_net.cpp). It does NOT
 * implement the `/signalk/v1/access/requests` flow, so it can never obtain a
 * token by itself. With security enabled and no token, Signal K closes the
 * unauthenticated stream on a timer — the observed symptom is OpenCPN
 * reconnecting every 60 seconds and losing its data feed each time.
 *
 * So the plugin obtains one on OpenCPN's behalf, using the same access-request
 * machinery the admin UI drives.
 */

import { errMsg } from 'signalk-container-helper'

export const DEVICE_CLIENT_ID = 'signalk-opencpn'
const DEVICE_DESCRIPTION = 'OpenCPN'
/** OpenCPN writes routes and waypoints back to Signal K, so read alone is not enough. */
const DEVICE_PERMISSIONS = 'readwrite'

/** The slice of Signal K's security strategy this module needs. */
export interface SecurityStrategyLike {
  isDummy?: () => boolean
  getConfiguration?: () => { devices?: { clientId?: string }[] } | undefined
  requestAccess?: (
    config: unknown,
    clientRequest: {
      requestId?: string
      accessRequest: {
        clientId?: string
        description?: string
        permissions?: string
      }
    },
    sourceIp: string,
    updateCb?: (reply: unknown) => void
  ) => Promise<unknown>
}

/** Shape of the completion payload delivered to `requestAccess`'s updateCb. */
interface AccessRequestUpdate {
  statusCode?: number
  requestId?: string
  data?: { permission?: string; token?: string }
}

/** Shape of `app.queryRequest(requestId)`'s reply. */
interface RequestReply {
  state?: string
  statusCode?: number
  accessRequest?: { permission?: string; token?: string }
}

/** Poll a previously filed access request for its outcome. */
export type QueryRequest = (requestId: string) => Promise<unknown>

export type ProvisionOutcome =
  /** Security is off; OpenCPN needs no token. */
  | { kind: 'not-needed' }
  /** A token we already hold is still backed by a registered device. */
  | { kind: 'existing'; token: string }
  /** The device was approved and a token issued. */
  | { kind: 'provisioned'; token: string }
  /**
   * An access request is filed and waiting for a human to approve it. The id
   * must be persisted: the token is delivered to that request when it is
   * approved, and polling it is the only way to collect it afterwards.
   */
  | { kind: 'pending'; requestId?: string }
  /**
   * We hold a token but the device is gone: an operator revoked it. Treated as
   * a deliberate act — asking again here would nag forever.
   */
  | { kind: 'revoked' }
  /** An operator refused the request; the id is dead and must be dropped. */
  | { kind: 'denied' }
  /** Provisioning was attempted and failed, or the API is unavailable. */
  | { kind: 'failed'; reason: string }

/** True when Signal K security is on (a real strategy, not the dummy one). */
export function securityEnabled(strategy: SecurityStrategyLike | undefined): boolean {
  if (!strategy) return false
  // The dummy strategy reports itself; treat an older strategy without the
  // method as real, since a false negative would skip needed provisioning.
  return strategy.isDummy ? !strategy.isDummy() : true
}

/** Is our device still in Signal K's device registry? */
export function deviceRegistered(strategy: SecurityStrategyLike | undefined): boolean {
  const devices = strategy?.getConfiguration?.()?.devices
  if (!devices) return false
  return devices.some((d) => d.clientId === DEVICE_CLIENT_ID)
}

/**
 * Ensure OpenCPN has a usable Signal K token.
 *
 * The device registry, not the stored token, is the source of truth: a token
 * whose device has been deleted is dead the moment it is deleted (Signal K
 * resolves the principal from the live device list on every request), and
 * re-issuing one would defeat the revocation.
 */
export async function ensureDeviceToken(
  strategy: SecurityStrategyLike | undefined,
  storedToken: string | undefined,
  pendingRequestId?: string,
  queryRequest?: QueryRequest
): Promise<ProvisionOutcome> {
  if (!securityEnabled(strategy)) return { kind: 'not-needed' }
  if (!strategy) return { kind: 'failed', reason: 'no security strategy' }

  if (storedToken) {
    return deviceRegistered(strategy)
      ? { kind: 'existing', token: storedToken }
      : { kind: 'revoked' }
  }

  // A request filed on an earlier start may have been approved since. The
  // token was delivered to that request, not to us, so it has to be collected
  // by polling — this is the flow a normal device client uses.
  if (pendingRequestId && queryRequest) {
    const collected = await collectApproved(pendingRequestId, queryRequest)
    if (collected) return collected
  }

  const requestAccess = strategy.requestAccess
  if (!requestAccess) {
    return { kind: 'failed', reason: 'security strategy has no access-request API' }
  }

  try {
    // The token arrives once, on this callback, if and when the request is
    // approved — either immediately (already approved) or later, when a human
    // clicks approve in Security → Access Requests. Deliberately NOT
    // self-approved: granting a device access to the whole Signal K data model
    // is an operator's decision.
    let issued: string | undefined
    const onUpdate = (reply: unknown): void => {
      const update = reply as AccessRequestUpdate
      if (update.data?.token) issued = update.data.token
    }

    const reply = (await requestAccess(
      config(strategy),
      {
        accessRequest: {
          clientId: DEVICE_CLIENT_ID,
          description: DEVICE_DESCRIPTION,
          permissions: DEVICE_PERMISSIONS
        }
      },
      '127.0.0.1',
      onUpdate
    )) as AccessRequestUpdate | undefined

    const requestId = reply?.requestId
    if (issued) return { kind: 'provisioned', token: issued }

    const status = reply?.statusCode
    // 202 = created and PENDING: normal, a human approves it next.
    if (status === undefined || status === 202 || status === 200) {
      return { kind: 'pending', requestId }
    }
    // 400 usually means a request for this clientId is already pending.
    if (status === 400) return { kind: 'pending', requestId }
    return {
      kind: 'failed',
      reason: `Signal K refused the access request (status ${String(status)})`
    }
  } catch (err) {
    return { kind: 'failed', reason: errMsg(err) }
  }
}

function config(strategy: SecurityStrategyLike): unknown {
  return strategy.getConfiguration?.()
}

/**
 * Check a filed request for an approval that happened while we were not
 * listening, which is the normal case: an operator approves minutes or days
 * after the plugin asked.
 */
async function collectApproved(
  requestId: string,
  queryRequest: QueryRequest
): Promise<ProvisionOutcome | null> {
  let reply: RequestReply
  try {
    reply = (await queryRequest(requestId)) as RequestReply
  } catch {
    // Requests live in memory, so a server restart loses them. Nothing to
    // collect; the caller files a fresh one.
    return null
  }

  const token = reply.accessRequest?.token
  if (token) return { kind: 'provisioned', token }
  if (reply.accessRequest?.permission === 'DENIED') return { kind: 'denied' }
  // Still pending: keep waiting on the same request rather than filing another.
  if (reply.state === 'PENDING') return { kind: 'pending', requestId }
  return null
}
