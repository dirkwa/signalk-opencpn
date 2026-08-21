/**
 * Work out the browser-facing URL of the OpenCPN web UI.
 *
 * The container uses host networking, so OpenCPN is on the SAME host as Signal
 * K but a different port. Rather than baking in a hostname, we reuse whatever
 * the browser used to reach Signal K and swap the port — so the link is right
 * whether the user typed an IP, a .local name, or came through a reverse
 * proxy. Mirrors signalk-doctor's resolveGuiUrl().
 */

export interface HeaderSource {
  get(name: string): string | undefined
}

/** Strip any :port, and unwrap a bracketed IPv6 literal's port correctly. */
function stripPort(host: string): string {
  if (host.startsWith('[')) {
    // [::1]:3000 → [::1]
    const close = host.indexOf(']')
    return close === -1 ? host : host.slice(0, close + 1)
  }
  const colon = host.indexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

/**
 * @param headers  request headers (X-Forwarded-Host wins over Host)
 * @param port     the Xpra port
 * @returns absolute http URL, or null when no host header is present
 */
export function resolveGuiUrl(headers: HeaderSource, port: number): string | null {
  const forwarded = headers.get('x-forwarded-host')
  // A proxy may send a comma-separated list; the first entry is the client-facing one.
  const raw = (forwarded?.split(',')[0] ?? headers.get('host'))?.trim()
  if (!raw) return null

  const host = stripPort(raw)
  if (!host) return null

  // Always http: Xpra in this image serves plain HTTP, so honouring an
  // X-Forwarded-Proto of https would produce a URL that cannot connect.
  return `http://${host}:${String(port)}/`
}
