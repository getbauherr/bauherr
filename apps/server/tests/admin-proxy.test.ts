import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let user: { role: string; email: string } | null
vi.mock('../src/app/(app)/lib/session', () => ({ getBauherr: async () => user, payloadClient: async () => payload, WS_COOKIE: 'bauherr-ws' }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const o = { overrideAccess: true } as const
let proxy: typeof import('../src/app/(app)/lib/admin-proxy')
let testDb: TestDb
const fetchMock = vi.fn()
const target = (over: Partial<{ url: string | undefined; writes: boolean }> = {}) => ({ name: 'Gateway', url: 'http://gw.test:15000', hint: 'run <code>docker compose port gateway 15000</code>', writes: false, ...over })
const request = (method = 'GET', init: RequestInit = {}) => new Request('http://bauherr.test/-/gateway/config_dump?a=1', { method, ...init })
const touches = async () => (await payload.find({ collection: 'human_touches', where: { kind: { like: 'gateway:' } }, ...o })).docs as unknown as { kind: string; path: string; actor: string }[]

beforeAll(async () => {
  testDb = await createTestDb('admin_proxy_55')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })
  proxy = await import('../src/app/(app)/lib/admin-proxy')
  vi.stubGlobal('fetch', fetchMock)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await payload?.destroy()
  await testDb?.drop(payload)
})

afterEach(() => {
  fetchMock.mockReset()
  user = { role: 'admin', email: 'root@x.io' }
})

describe('proxyAdmin', () => {
  it('answers 404 to a non-admin and to nobody, without calling the target', async () => {
    for (const u of [{ role: 'bauherr', email: 'm@x.io' }, null]) {
      user = u
      expect((await proxy.proxyAdmin(request(), target(), ['config_dump'])).status).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards an admin GET without cookies or Authorization and streams the answer back', async () => {
    user = { role: 'admin', email: 'root@x.io' }
    fetchMock.mockResolvedValue(new Response('hello', { status: 200, headers: { 'content-type': 'text/plain', 'set-cookie': 'a=b', 'content-encoding': 'gzip' } }))
    const res = await proxy.proxyAdmin(request('GET', { headers: { cookie: 'payload-token=s', authorization: 'Bearer t', 'x-bauherr-session': 'z', accept: 'text/html' } }), target(), ['config_dump'])
    expect(await res.text()).toBe('hello')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('content-encoding')).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://gw.test:15000/config_dump?a=1')
    expect([...(init.headers as unknown as Map<string, string>).keys()]).toEqual(['accept'])
  })

  it('sandboxes every proxied answer (upstream and fallback) and never passes cookies either way', async () => {
    user = { role: 'admin', email: 'root@x.io' }
    fetchMock.mockResolvedValue(new Response('<script>document.cookie</script>', { status: 200, headers: { 'content-type': 'text/html', 'content-security-policy': "default-src 'self'", 'set-cookie': 'payload-token=evil' } }))
    const res = await proxy.proxyAdmin(request('GET', { headers: { cookie: 'payload-token=s' } }), target(), ['config_dump'])
    expect(res.headers.get('content-security-policy')).toBe(`default-src 'self', ${proxy.SANDBOX}`)
    expect(res.headers.get('content-security-policy')).not.toMatch(/allow-same-origin/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect((fetchMock.mock.calls[0]![1].headers as Headers).has('cookie')).toBe(false)
    fetchMock.mockRejectedValue(new Error('down'))
    const down = await proxy.proxyAdmin(request(), target(), ['config_dump'])
    expect([down.status, down.headers.get('content-security-policy'), down.headers.get('x-content-type-options')]).toEqual([502, proxy.SANDBOX, 'nosniff'])
  })

  it('refuses a POST without the write flag and audits nothing', async () => {
    const res = await proxy.proxyAdmin(request('POST', { body: '{}' }), target(), ['api'])
    expect(res.status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await touches()).toHaveLength(0)
  })

  it('allows a POST with the flag and records it in human_touches', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    const res = await proxy.proxyAdmin(request('POST', { body: '{"a":1}', headers: { 'content-type': 'application/json' } }), target({ writes: true }), ['api', 'keys'])
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST')
    expect(await touches()).toMatchObject([{ kind: 'gateway:POST', path: '/api/keys', actor: 'root@x.io' }])
  })

  it('probes Jaeger with HEAD and caches the answer for 60 s', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    expect(await proxy.tracesUp('http://jaeger.test:16686')).toBe(true)
    expect(await proxy.tracesUp('http://jaeger.test:16686')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1].method).toBe('HEAD')
    expect(String(fetchMock.mock.calls[0]![0])).toBe('http://jaeger.test:16686/-/traces/')
  })

  it('shows the fallback page when the target is unreachable or unset', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    for (const url of ['http://gw.test:15000', undefined]) {
      const res = await proxy.proxyAdmin(request(), target({ url }), ['config_dump'])
      expect(res.status).toBe(502)
      expect(await res.text()).toContain('docker compose port gateway 15000')
    }
  })
})
