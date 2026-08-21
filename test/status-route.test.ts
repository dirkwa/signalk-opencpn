import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

// The plugin factory constructs a ManagedContainer at module scope, which
// would try to reach signalk-container. Stub the module so these tests
// exercise only the routing/serialisation the plugin itself owns.
const getInfo = vi.fn(() =>
  Promise.resolve({ state: 'running' as const, image: 'npgause/opencpn-kiosk:x86' })
)
const registerUpdateRoutes = vi.fn()

vi.mock('signalk-container-helper', () => ({
  ManagedContainer: class {
    getInfo = getInfo
    registerUpdateRoutes = registerUpdateRoutes
    start = vi.fn()
    stop = vi.fn()
  },
  waitForContainerManager: vi.fn(),
  resolveMount: vi.fn(),
  startSafely: vi.fn(),
  errMsg: (e: unknown) => String(e)
}))

const { default: pluginFactory } = await import('../src/index.js')

interface StatusBody {
  container?: { state?: string; image?: string }
  ready?: boolean
  gpu?: boolean
  url?: string | null
}

function makeApp() {
  const plugin = pluginFactory({
    debug: vi.fn(),
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    getDataDirPath: () => '/tmp/data',
    savePluginOptions: vi.fn()
  })
  const app = express()
  const router = express.Router()
  plugin.registerWithRouter(router)
  app.use(router)
  return app
}

describe('GET /api/status', () => {
  it('reports container state and a launch URL derived from the request host', async () => {
    const res = await request(makeApp()).get('/api/status').set('Host', 'boat.local:3000')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      container: { state: 'running', image: 'npgause/opencpn-kiosk:x86' },
      ready: true,
      url: 'http://boat.local:14500/'
    })
  })

  it('honours X-Forwarded-Host so the link works behind a proxy', async () => {
    const res = await request(makeApp())
      .get('/api/status')
      .set('Host', '127.0.0.1:3000')
      .set('X-Forwarded-Host', 'nav.example.com')
    expect((res.body as StatusBody).url).toBe('http://nav.example.com:14500/')
  })

  it('reports ready:false when the container is not running', async () => {
    getInfo.mockResolvedValueOnce({ state: 'stopped' as const, image: '' })
    const res = await request(makeApp()).get('/api/status').set('Host', 'boat.local:3000')
    expect((res.body as StatusBody).ready).toBe(false)
  })

  it('registers the helper update routes', () => {
    makeApp()
    expect(registerUpdateRoutes).toHaveBeenCalled()
  })
})
