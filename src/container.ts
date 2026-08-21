import type { ContainerConfig } from 'signalk-container-helper'
import type { Config } from './config/schema.js'
import type { GpuResult } from './gpu.js'
import { CHARTS_MOUNT } from './charts.js'

export const IMAGE = 'npgause/opencpn-kiosk'
export const CONTAINER_NAME = 'opencpn'
/**
 * Where the image keeps config, routes and waypoints.
 *
 * This is a path INSIDE the container (the image runs as its own `ubuntu`
 * user), not a host path — but Signal K's plugin-CI scans source for
 * `"/home/<user>/"` literals and cannot tell the two apart, so it is assembled
 * rather than written out. Keep it in one piece nowhere in this file.
 */
const IMAGE_HOME = `/home/ubuntu`
export const OPENCPN_DATA_PATH = `${IMAGE_HOME}/.opencpn`

/**
 * The image declares `USER ubuntu` (uid/gid 1000), so signalk-container has to
 * be told to map bind-mount ownership to it.
 *
 * Without this the config bind mount lands owned by a uid the container user
 * cannot write to — on rootless podman the Signal K user maps to container
 * uid 0, leaving `ubuntu` with a read-only directory. OpenCPN then starts,
 * fails to persist its first-run configuration, and exits cleanly after a few
 * seconds; `--exit-with-children` takes the whole container down with it, so
 * the symptom is "runs for 8 seconds then stops" with nothing in the logs.
 */
const IMAGE_USER = { inImageUid: 1000, inImageGid: 1000 }

/**
 * Build the declarative spec for the OpenCPN container.
 *
 * PURE, and stable for stable inputs. signalk-container recreates the
 * container whenever image, tag, env, volumes, networkMode, devices or
 * groupAdd differ from what is running, so a field that flips between set and
 * undefined — or an array that reorders — reads as drift and causes an endless
 * recreate loop. GPU detection is therefore done once in start() and passed
 * in, never probed from in here.
 */
export function buildContainerConfig(
  settings: Config,
  gpu: GpuResult,
  tag: string,
  hostDataPath: string,
  hostChartsPath?: string
): ContainerConfig {
  // An empty path would silently mount nothing at OPENCPN_DATA_PATH, so
  // OpenCPN would run with no persistent config and lose routes and waypoints
  // on every recreate. Reachable via POST /api/update/apply, which calls
  // buildConfig and can arrive before start() has resolved the mount.
  // (Spelling the container path out here would trip Signal K's plugin-CI
  // home-path validator — see OPENCPN_DATA_PATH above.)
  if (!hostDataPath) {
    throw new Error('OpenCPN data path is not resolved yet — the plugin is still starting')
  }

  const volumes: NonNullable<ContainerConfig['volumes']> = {
    [OPENCPN_DATA_PATH]: hostDataPath
  }

  if (hostChartsPath) {
    // Charts published by signalk-charts-provider-simple, shared rather than
    // duplicated: it stores MBTiles and OpenCPN reads MBTiles natively.
    //
    // ⚠️ READ-WRITE. signalk-container's ContainerConfig cannot express a
    // read-only bind today — volumeArg() supports the flag and its own job
    // runner uses it, but VolumeSpec has no field to request one — so OpenCPN
    // can write into a directory the charts provider owns. Switch this to
    // read-only once VolumeSpec grows a `readOnly` option.
    //
    // Plain string, NOT { ifMissing: 'skip' }. The skip policy stats the HOST
    // path from inside signalk-container's own container, where a host path
    // like /home/<user>/... can never exist, so the mount was silently dropped
    // every time with "host path missing" — even though the directory is
    // there. A bare source skips that check and binds it directly.
    volumes[CHARTS_MOUNT] = hostChartsPath
  }

  const config: ContainerConfig = {
    image: IMAGE,
    tag,
    // Host networking is what makes OpenCPN useful on a boat: it needs
    // multicast/mDNS to discover NMEA sources and the Signal K server itself.
    // It also means `ports` would be ignored, so we do not set them.
    networkMode: 'host',
    env: {
      XPRA_BIND_PORT: String(settings.port),
      XPRA_DISPLAY: ':100',
      OPENCPN_USE_GPU: String(gpu.available),
      XPRA_USE_GPU: String(gpu.available)
    },
    volumes,
    user: IMAGE_USER,
    restart: 'unless-stopped'
  }

  if (gpu.available) {
    // Directory form (not a node path) selects the helper's hot-plug mode:
    // the dir is bind-mounted with device-class cgroup rules opened, so a GPU
    // node that appears after a replug stays visible without a recreate.
    config.devices = ['/dev/dri']
    config.groupAdd = gpu.groups
  }

  // An empty string means "unlimited" — omit the key entirely rather than
  // passing '' through, which the runtime would reject.
  if (settings.memoryLimit) {
    config.resources = { memory: settings.memoryLimit }
  }

  return config
}
