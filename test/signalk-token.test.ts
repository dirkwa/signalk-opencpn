import { describe, expect, it, vi } from 'vitest'
import {
  DEVICE_CLIENT_ID,
  deviceRegistered,
  ensureDeviceToken,
  securityEnabled,
  type SecurityStrategyLike
} from '../src/signalk-token.js'

const TOKEN = 'issued.jwt.here'

/**
 * Mirrors how Signal K really behaves (src/tokensecurity.ts): requestAccess
 * creates a PENDING request and resolves with statusCode 202. The token is
 * delivered ONCE through the update callback, if and when a human approves it —
 * it is never stored on the device record.
 */
function strategy(over: Partial<SecurityStrategyLike> = {}): SecurityStrategyLike {
  return {
    isDummy: () => false,
    getConfiguration: () => ({ devices: [] }),
    requestAccess: vi.fn((): Promise<unknown> => Promise.resolve({ statusCode: 202 })),
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
    expect(await ensureDeviceToken({ isDummy: () => true }, undefined)).toEqual({
      kind: 'not-needed'
    })
  })

  it('files a request and waits for a human when none exists yet', async () => {
    expect(await ensureDeviceToken(strategy(), undefined)).toEqual({ kind: 'pending' })
  })

  it('returns the token when the request is approved during the call', async () => {
    const s = strategy({
      requestAccess: vi.fn((_c, _r, _ip, cb?: (reply: unknown) => void): Promise<unknown> => {
        cb?.({ statusCode: 200, data: { permission: 'APPROVED', token: TOKEN } })
        return Promise.resolve({ statusCode: 200 })
      })
    })
    expect(await ensureDeviceToken(s, undefined)).toEqual({ kind: 'provisioned', token: TOKEN })
  })

  it('stays pending when a request for us is already queued (400)', async () => {
    const s = strategy({
      requestAccess: vi.fn((): Promise<unknown> => Promise.resolve({ statusCode: 400 }))
    })
    expect(await ensureDeviceToken(s, undefined)).toEqual({ kind: 'pending' })
  })

  it('reuses a stored token while the device is still registered', async () => {
    const s = strategy({ getConfiguration: () => ({ devices: [{ clientId: DEVICE_CLIENT_ID }] }) })
    expect(await ensureDeviceToken(s, 'stored.jwt')).toEqual({
      kind: 'existing',
      token: 'stored.jwt'
    })
  })

  // A deleted device is a deliberate revocation, and Signal K resolves the
  // principal from the live device list on every request, so the stored token is
  // already dead. Asking again would nag the operator forever.
  it('treats a deleted device as a revocation and does not ask again', async () => {
    const requestAccess = vi.fn((): Promise<unknown> => Promise.resolve({ statusCode: 202 }))
    const s = strategy({ getConfiguration: () => ({ devices: [] }), requestAccess })
    expect(await ensureDeviceToken(s, 'stored.jwt')).toEqual({ kind: 'revoked' })
    expect(requestAccess).not.toHaveBeenCalled()
  })

  it('reports failure when the strategy has no access-request API', async () => {
    const r = await ensureDeviceToken({ isDummy: () => false }, undefined)
    expect(r.kind).toBe('failed')
  })

  it('reports a refusal rather than throwing', async () => {
    const s = strategy({
      requestAccess: vi.fn((): Promise<unknown> => Promise.resolve({ statusCode: 403 }))
    })
    const r = await ensureDeviceToken(s, undefined)
    expect(r).toMatchObject({ kind: 'failed' })
  })

  it('asks for readwrite, since OpenCPN writes routes and waypoints back', async () => {
    const calls: unknown[][] = []
    const requestAccess = vi.fn((...args: unknown[]): Promise<unknown> => {
      calls.push(args)
      return Promise.resolve({ statusCode: 202 })
    })
    await ensureDeviceToken(strategy({ requestAccess }), undefined)
    const req = calls[0]?.[1] as { accessRequest?: { clientId?: string; permissions?: string } }
    expect(req.accessRequest?.clientId).toBe(DEVICE_CLIENT_ID)
    expect(req.accessRequest?.permissions).toBe('readwrite')
  })
})
