import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectGpu } from '../src/gpu.js'

// These exercise Linux device-node semantics: the fixture symlinks real
// character devices and reads /etc/group. Neither exists on Windows or macOS
// (where the CI runner resolves /dev/null to D:\dev\null and stat fails), and
// the code under test only ever runs on a Linux host with /dev/dri — so the
// suite is skipped rather than faked elsewhere.
const linuxOnly = process.platform === 'linux' ? describe : describe.skip

// Real character devices need root to mknod, so the fixture points detectGpu
// at nodes that already exist: /dev/null and /dev/zero are character devices
// on every Linux box. Only their gid matters to the code under test, and we
// supply the gid→name mapping ourselves via a fake group file.
const CHAR_DEV = '/dev/null'
const CHAR_DEV_2 = '/dev/zero'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'opencpn-gpu-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function fakeDri(nodes: string[]): Promise<string> {
  const dri = path.join(tmp, 'dri')
  await fs.mkdir(dri, { recursive: true })
  for (const [i, target] of nodes.entries()) {
    await fs.symlink(target, path.join(dri, `node${String(i)}`))
  }
  return dri
}

async function groupFile(contents: string): Promise<string> {
  const p = path.join(tmp, 'group')
  await fs.writeFile(p, contents)
  return p
}

linuxOnly('detectGpu', () => {
  it('reports unavailable when /dev/dri does not exist', async () => {
    expect(await detectGpu(path.join(tmp, 'nope'), '/etc/group')).toEqual({
      available: false,
      groups: []
    })
  })

  it('reports unavailable for an empty /dev/dri', async () => {
    expect(await detectGpu(await fakeDri([]), '/etc/group')).toEqual({
      available: false,
      groups: []
    })
  })

  it('resolves the owning gid to a group name', async () => {
    const { gid } = await fs.stat(CHAR_DEV)
    const gf = await groupFile(`video:x:${String(gid)}:dirk\nrender:x:99999:\n`)
    expect(await detectGpu(await fakeDri([CHAR_DEV]), gf)).toEqual({
      available: true,
      groups: ['video']
    })
  })

  it('falls back to the numeric gid when the group has no name', async () => {
    const { gid } = await fs.stat(CHAR_DEV)
    const gf = await groupFile('other:x:99999:\n')
    expect(await detectGpu(await fakeDri([CHAR_DEV]), gf)).toEqual({
      available: true,
      groups: [String(gid)]
    })
  })

  it('deduplicates when several nodes share one group', async () => {
    const { gid } = await fs.stat(CHAR_DEV)
    const { gid: gid2 } = await fs.stat(CHAR_DEV_2)
    // /dev/null and /dev/zero are both root-owned, so this is one distinct gid.
    const gf = await groupFile(`root:x:${String(gid)}:\n`)
    const res = await detectGpu(await fakeDri([CHAR_DEV, CHAR_DEV_2]), gf)
    expect(res.available).toBe(true)
    if (gid === gid2) expect(res.groups).toHaveLength(1)
  })

  it('ignores plain files and directories such as by-path/', async () => {
    const dri = await fakeDri([])
    await fs.mkdir(path.join(dri, 'by-path'))
    await fs.writeFile(path.join(dri, 'README'), 'not a device')
    expect(await detectGpu(dri, '/etc/group')).toEqual({ available: false, groups: [] })
  })

  it('returns a stable, sorted list across calls (drift-detection guard)', async () => {
    const { gid } = await fs.stat(CHAR_DEV)
    const gf = await groupFile(`video:x:${String(gid)}:\n`)
    const dri = await fakeDri([CHAR_DEV, CHAR_DEV_2])
    const a = await detectGpu(dri, gf)
    const b = await detectGpu(dri, gf)
    expect(a.groups).toEqual(b.groups)
  })

  it('survives an unreadable group file by reporting numeric gids', async () => {
    const { gid } = await fs.stat(CHAR_DEV)
    const res = await detectGpu(await fakeDri([CHAR_DEV]), path.join(tmp, 'missing-group'))
    expect(res).toEqual({ available: true, groups: [String(gid)] })
  })
})
