/**
 * Image-tag selection for npgause/opencpn-kiosk.
 *
 * The image publishes NO multi-arch manifest and has NO `latest` tag — just
 * two arch-specific tags, `x86` (linux/amd64) and `pi` (linux/arm64). Docker
 * therefore cannot pick one for us the way it does for a normal image, so the
 * plugin resolves it from the host architecture instead.
 */

/** Tag run on 64-bit ARM (Raspberry Pi, HALPI2, Apple-silicon VMs). */
export const TAG_ARM64 = 'pi'
/** Tag run on x86-64. */
export const TAG_AMD64 = 'x86'
/** User-facing tag meaning "pick the right one for this machine". */
export const TAG_AUTO = 'auto'

/**
 * Map the configured tag to the one actually pulled.
 *
 * Anything other than `auto` is passed through untouched so an operator can
 * pin a specific tag without the plugin second-guessing them.
 *
 * Synchronous by design: this is wired straight into ManagedContainer's
 * `resolveTag`, which is not async. Unlike signalk-backup's auto-tag
 * resolution it needs no network — the answer is a property of this machine.
 */
export function resolveTag(requested: string, arch: string = process.arch): string {
  if (requested !== TAG_AUTO) return requested
  return arch === 'arm64' ? TAG_ARM64 : TAG_AMD64
}
