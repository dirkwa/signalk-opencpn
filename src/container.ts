import type { ContainerConfig } from 'signalk-container-helper'
import type { Config } from './config/schema.js'
import type { GpuResult } from './gpu.js'

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
  hostDataPath: string
): ContainerConfig {
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
    volumes: { [OPENCPN_DATA_PATH]: hostDataPath },
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
