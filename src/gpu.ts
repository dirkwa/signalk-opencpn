/**
 * GPU auto-detection for the OpenCPN container.
 *
 * Upstream's compose example hardcodes `group_add: "993"` — the render gid on
 * THEIR machine. Copying that literal is a silent-failure trap: gids differ
 * per distro and per install, so on another host 993 is either a different
 * group or nothing at all, and the container loses GPU access while looking
 * perfectly healthy. This dev VM is a live example — /dev/dri holds only
 * `card0` owned by group `video` (44), with no renderD128 and `render` at 992.
 *
 * So instead of trusting a number, we stat the device nodes that are actually
 * there and ask the host which groups own them.
 *
 * ⚠️ This probes the filesystem of whatever process runs it. When Signal K is
 * itself containerized — the common deployment — that is the Signal K
 * container, which has no /dev/dri even though the HOST does. Detection then
 * correctly reports "no GPU" for its own namespace while the machine that will
 * actually run OpenCPN has one. There is no way to see the host's /dev/dri
 * from inside, so the result is treated as a best-effort hint: a false
 * negative costs hardware acceleration, never a failed start.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

export const DRI_PATH = '/dev/dri'

export interface GpuResult {
  /** True when at least one usable /dev/dri node exists. */
  available: boolean
  /** Distinct host group NAMES owning those nodes (numeric gid if unnamed). */
  groups: string[]
}

/** Parse /etc/group into gid → name. Unreadable file simply yields no names. */
async function readGroupNames(groupFile: string): Promise<Map<number, string>> {
  const byGid = new Map<number, string>()
  let raw: string
  try {
    raw = await fs.readFile(groupFile, 'utf8')
  } catch {
    return byGid
  }
  for (const line of raw.split('\n')) {
    // name:password:gid:members
    const parts = line.split(':')
    const name = parts[0]
    const gidRaw = parts[2]
    if (!name || gidRaw === undefined) continue
    const gid = Number.parseInt(gidRaw, 10)
    // First definition wins: /etc/group may alias a gid to several names, and
    // the earlier entry is the canonical one on every distro we care about.
    if (!Number.isNaN(gid) && !byGid.has(gid)) byGid.set(gid, name)
  }
  return byGid
}

/**
 * Probe /dev/dri and report whether GPU passthrough is possible, plus the
 * groups the container needs to hold to use it.
 *
 * Group NAMES are returned rather than gids because signalk-container-helper
 * resolves names against the HOST's /etc/group (the gid the kernel actually
 * checks on host device nodes) — passing a name is both portable and what the
 * helper's rootless-podman handling expects.
 *
 * Never throws: a machine with no GPU is a normal, supported configuration,
 * and OpenCPN falls back to CPU rendering.
 */
export async function detectGpu(
  driPath: string = DRI_PATH,
  groupFile = '/etc/group'
): Promise<GpuResult> {
  let entries: string[]
  try {
    entries = await fs.readdir(driPath)
  } catch {
    return { available: false, groups: [] }
  }

  const gids = new Set<number>()
  for (const entry of entries) {
    try {
      const st = await fs.stat(path.join(driPath, entry))
      // Only character devices are GPU nodes; skip the `by-path/` directory.
      if (st.isCharacterDevice()) gids.add(st.gid)
    } catch {
      // Node vanished between readdir and stat (hot-unplug) — ignore it.
    }
  }

  if (gids.size === 0) return { available: false, groups: [] }

  const names = await readGroupNames(groupFile)
  // Sorted so the value is stable across calls: this feeds `groupAdd`, which
  // signalk-container drift-detects, and a reordered array would look like a
  // config change and trigger an endless recreate loop.
  const groups = [...gids].sort((a, b) => a - b).map((gid) => names.get(gid) ?? String(gid))

  return { available: true, groups }
}
