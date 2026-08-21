import { describe, expect, it } from 'vitest'
import { resolveGuiUrl } from '../src/gui-url.js'

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] }
}

describe('resolveGuiUrl', () => {
  it('swaps the Signal K port for the Xpra port', () => {
    expect(resolveGuiUrl(headers({ host: 'boat.local:3000' }), 14500)).toBe(
      'http://boat.local:14500/'
    )
  })

  it('handles a host with no port', () => {
    expect(resolveGuiUrl(headers({ host: 'boat.local' }), 14500)).toBe('http://boat.local:14500/')
  })

  it('prefers X-Forwarded-Host behind a reverse proxy', () => {
    const h = headers({ host: '127.0.0.1:3000', 'x-forwarded-host': 'nav.example.com' })
    expect(resolveGuiUrl(h, 14500)).toBe('http://nav.example.com:14500/')
  })

  it('takes the first entry of a comma-separated X-Forwarded-Host', () => {
    const h = headers({ 'x-forwarded-host': 'nav.example.com, inner.lan' })
    expect(resolveGuiUrl(h, 14500)).toBe('http://nav.example.com:14500/')
  })

  it('keeps a bracketed IPv6 literal intact while dropping its port', () => {
    expect(resolveGuiUrl(headers({ host: '[fd00::1]:3000' }), 14500)).toBe(
      'http://[fd00::1]:14500/'
    )
  })

  it('returns null when there is no host header to work from', () => {
    expect(resolveGuiUrl(headers({}), 14500)).toBeNull()
  })
})
