import { describe, expect, it, vi } from 'vitest'
import {
  DEVICE_CLIENT_ID,
  deviceRegistered,
  ensureDeviceToken,
  securityEnabled,
  type SecurityStrategyLike
} from '../src/signalk-token.js'

const TOKEN = 'issued.jwt.here'

function strategy(over: Partial<SecurityStrategyLike> = {}): SecurityStrategyLike {
  return {
    isDummy: () => false,
    getConfiguration: () => ({ devices: [] }),
    requestAccess: vi.fn((): Promise<unknown> => Promise.resolve({})),
    setAccessRequestStatus: (_c, _id, _status, _body, cb) => {
      cb(null, { devices: [{ clientId: DEVICE_CLIENT_ID, accessToken: TOKEN }] })
    },
    ...over
  }
}

describe('securityEnabled', () => {
  it('is false when the dummy strategy is in use', () => {
    expect(securityEnabled({ isDummy: () => true })).toBe(false)
  })

  it('is false when there is no strategy at all', () => {
    expect(securityEnabled(undefined)).toBe(false)
  })

  it('assumes a strategy without isDummy is real, so provisioning is not skipped', () => {
    expect(securityEnabled({})).toBe(true)
  })
})

describe('deviceRegistered', () => {
  it('finds our device in the registry', () => {
    const s = strategy({ getConfiguration: () => ({ devices: [{ clientId: DEVICE_CLIENT_ID }] }) })
    expect(deviceRegistered(s)).toBe(true)
  })

  it('is false when other devices exist but ours does not', () => {
    const s = strategy({ getConfiguration: () => ({ devices: [{ clientId: 'something-else' }] }) })
    expect(deviceRegistered(s)).toBe(false)
  })
})

describe('ensureDeviceToken', () => {
  it('does nothing when security is off', async () => {
    const r = await ensureDeviceToken({ isDummy: () => true }, undefined)
    expect(r).toEqual({ kind: 'not-needed' })
  })

  it('issues a token on first run', async () => {
    const r = await ensureDeviceToken(strategy(), undefined)
    expect(r).toEqual({ kind: 'provisioned', token: TOKEN })
  })

  it('reuses a stored token while the device is still registered', async () => {
    const s = strategy({ getConfiguration: () => ({ devices: [{ clientId: DEVICE_CLIENT_ID }] }) })
    const r = await ensureDeviceToken(s, 'stored.jwt')
    expect(r).toEqual({ kind: 'existing', token: 'stored.jwt' })
  })

  // The important one: a deleted device is a deliberate revocation, and Signal K
  // resolves the principal from the live device list on every request, so the
  // stored token is already dead. Minting a replacement would undo the operator's
  // action on the next restart.
  it('treats a deleted device as a revocation and does not re-provision', async () => {
    const requestAccess = vi.fn((): Promise<unknown> => Promise.resolve({}))
    const s = strategy({ getConfiguration: () => ({ devices: [] }), requestAccess })
    const r = await ensureDeviceToken(s, 'stored.jwt')
    expect(r).toEqual({ kind: 'revoked' })
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it('reports failure when approval yields no token', async () => {
    const s = strategy({
      setAccessRequestStatus: (_c, _id, _s, _b, cb) => {
        cb(null, { devices: [] })
      }
    })
    const r = await ensureDeviceToken(s, undefined)
    expect(r.kind).toBe('failed')
  })

  it('reports failure when the strategy has no access-request API', async () => {
    const r = await ensureDeviceToken({ isDummy: () => false }, undefined)
    expect(r.kind).toBe('failed')
  })

  it('reports failure rather than throwing when approval errors', async () => {
    const s = strategy({
      setAccessRequestStatus: (_c, _id, _st, _b, cb) => {
        cb(new Error('nope'))
      }
    })
    const r = await ensureDeviceToken(s, undefined)
    expect(r).toMatchObject({ kind: 'failed', reason: 'nope' })
  })

  it('asks for readwrite, since OpenCPN writes routes and waypoints back', async () => {
    const calls: unknown[][] = []
    const requestAccess = vi.fn((...args: unknown[]): Promise<unknown> => {
      calls.push(args)
      return Promise.resolve({})
    })
    await ensureDeviceToken(strategy({ requestAccess }), undefined)
    const req = calls[0]?.[1] as { accessRequest?: { clientId?: string; permissions?: string } }
    expect(req.accessRequest?.clientId).toBe(DEVICE_CLIENT_ID)
    expect(req.accessRequest?.permissions).toBe('readwrite')
  })
})
