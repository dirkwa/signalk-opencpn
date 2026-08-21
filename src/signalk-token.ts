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
  setAccessRequestStatus?: (
    config: unknown,
    identifier: string,
    status: string,
    body: { permissions?: string; expiration?: string },
    cb: (err: unknown, config?: unknown) => void
  ) => void
}

export type ProvisionOutcome =
  /** Security is off; OpenCPN needs no token. */
  | { kind: 'not-needed' }
  /** A token we already hold is still backed by a registered device. */
  | { kind: 'existing'; token: string }
  /** A fresh token was just issued. */
  | { kind: 'provisioned'; token: string }
  /**
   * We hold a token but the device is gone: an operator revoked it. Treated as
   * a deliberate act — re-provisioning here would silently undo it.
   */
  | { kind: 'revoked' }
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
  storedToken: string | undefined
): Promise<ProvisionOutcome> {
  if (!securityEnabled(strategy)) return { kind: 'not-needed' }
  if (!strategy) return { kind: 'failed', reason: 'no security strategy' }

  if (storedToken) {
    return deviceRegistered(strategy)
      ? { kind: 'existing', token: storedToken }
      : { kind: 'revoked' }
  }

  const requestAccess = strategy.requestAccess
  const setStatus = strategy.setAccessRequestStatus
  if (!requestAccess || !setStatus) {
    return { kind: 'failed', reason: 'security strategy has no access-request API' }
  }

  try {
    const config = strategy.getConfiguration?.()
    await requestAccess(
      config,
      {
        accessRequest: {
          clientId: DEVICE_CLIENT_ID,
          description: DEVICE_DESCRIPTION,
          permissions: DEVICE_PERMISSIONS
        }
      },
      '127.0.0.1'
    )

    const token = await new Promise<string>((resolve, reject) => {
      setStatus(
        config,
        DEVICE_CLIENT_ID,
        'APPROVED',
        { permissions: DEVICE_PERMISSIONS },
        (err: unknown, updated: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(errMsg(err)))
            return
          }
          const devices = (updated as { devices?: { clientId?: string; accessToken?: string }[] })
            .devices
          const issued = devices?.find((d) => d.clientId === DEVICE_CLIENT_ID)?.accessToken
          if (!issued) {
            reject(new Error('approval returned no access token'))
            return
          }
          resolve(issued)
        }
      )
    })

    return { kind: 'provisioned', token }
  } catch (err) {
    return { kind: 'failed', reason: errMsg(err) }
  }
}
