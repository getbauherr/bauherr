import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as tcp } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { parse } from 'yaml'
import { decrypt } from '../src/lib/secrets'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const o = { overrideAccess: true } as const
const dir = mkdtempSync(join(tmpdir(), 'monitoring-'))
const cfgPath = join(dir, 'config.yaml')
const cfg = () => parse(readFileSync(cfgPath, 'utf8'))
const SECRET = 'SECRET-MARK-9f3a'
let ws: number

const make = (service: string, config: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  payload.create({ collection: 'connections', data: { name: service, kind: 'monitoring', service, config, workspace: ws, ...extra } as never, ...o })
const list = () => payload.find({ collection: 'connections', where: { kind: { equals: 'monitoring' } }, pagination: false, ...o })
const wipe = async () => {
  for (const c of (await list()).docs) await payload.delete({ collection: 'connections', id: c.id, ...o })
}

beforeAll(async () => {
  testDb = await createTestDb('monitoring_571')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_CONFIG_DIR = dir
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.OTEL_ENABLED
  mkdirSync(join(dir, 'catalogs'))
  writeFileSync(cfgPath, 'llm:\n  models: []\n')
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'mon', slug: 'mon' }, ...o })).id as number
  process.env.GATEWAY_ADMIN_URL = 'http://gw.invalid' // only renderTracing runs; nothing calls it
})

afterAll(async () => {
  delete process.env.GATEWAY_ADMIN_URL
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('validates per service, refuses prometheus and a second entry of one service', async () => {
  await expect(make('otlp', { host: 'no-port' })).rejects.toThrow()
  await expect(make('otlp', { host: 'a.example:99999' })).rejects.toThrow()
  await expect(make('otlp', { host: 'a.example:4317', headerName: 'authorization' })).rejects.toThrow()
  await expect(make('otlp', { host: 'a.example:4317', uiUrl: 'javascript:alert(1)' })).rejects.toThrow()
  await expect(make('grafana', { url: 'https://user:pw@g.example' })).rejects.toThrow()
  await expect(make('grafana', { url: 'ftp://g.example' })).rejects.toThrow()
  await expect(make('prometheus', { url: 'https://p.example' })).rejects.toThrow()
  const g = await make('grafana', { url: 'https://g.example' })
  expect(g.config).toEqual({ url: 'https://g.example' })
  await expect(make('grafana', { url: 'https://other.example' })).rejects.toThrow()
  await expect(payload.update({ collection: 'connections', id: g.id, data: { service: 'otlp' } as never, ...o })).rejects.toThrow()
  await expect(payload.update({ collection: 'connections', id: g.id, data: { kind: 'github' } as never, ...o })).rejects.toThrow()
  await wipe()
})

it('simultaneous creates of one service leave exactly one', async () => {
  const results = await Promise.allSettled([make('grafana', { url: 'https://a.example' }), make('grafana', { url: 'https://b.example' }), make('grafana', { url: 'https://c.example' })])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect((await list()).totalDocs).toBe(1)
  await wipe()
})

it('only an Admin can read, write or delete them; a Bauherr keeps the other Connections; the secret never comes back in a read', async () => {
  const admin = await payload.create({ collection: 'bauherren', data: { email: 'adm@m.io', password: 'pw-123456', role: 'admin' }, ...o })
  const member = await payload.create({ collection: 'bauherren', data: { email: 'mem@m.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const row = await make('grafana', { url: 'https://g.example' }, { secret: SECRET })
  const github = await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws, secret: 'x' } as never, ...o })

  const asMember = { user: member, overrideAccess: false } as const
  const seen = await payload.find({ collection: 'connections', pagination: false, ...asMember })
  expect(seen.docs.map((d) => d.id)).toEqual([github.id])
  await expect(payload.findByID({ collection: 'connections', id: row.id, ...asMember })).rejects.toThrow()
  await expect(payload.update({ collection: 'connections', id: row.id, data: { name: 'x' }, ...asMember })).rejects.toThrow()
  await expect(payload.delete({ collection: 'connections', id: row.id, ...asMember })).rejects.toThrow()
  await expect(payload.create({ collection: 'connections', data: { name: 'p', kind: 'monitoring', service: 'otlp', config: { host: 'a.example:4317' }, workspace: ws } as never, ...asMember })).rejects.toThrow()
  expect((await payload.update({ collection: 'connections', id: github.id, data: { name: 'gh2' }, ...asMember })).name).toBe('gh2')

  const asAdmin = (await payload.findByID({ collection: 'connections', id: row.id, user: admin, overrideAccess: false })) as unknown as Record<string, unknown>
  expect(asAdmin.name).toBe('grafana')
  expect(JSON.stringify(asAdmin)).not.toContain(SECRET)
  expect(asAdmin.secret).toBeUndefined()
  const stored = (await payload.findByID({ collection: 'connections', id: row.id, showHiddenFields: true, ...o })) as unknown as { secret: string }
  expect(stored.secret).not.toContain(SECRET)
  expect(decrypt(stored.secret)).toBe(SECRET)
  await wipe()
})

it('saving Traces writes frontendPolicies.tracing (header in a 0600 file), saving again changes nothing, removing restores the bundled behaviour', async () => {
  const conn = await make('otlp', { host: 'collector.example:4317', headerName: 'authorization' }, { secret: `Bearer ${SECRET}` })
  expect(cfg().frontendPolicies.tracing).toEqual({
    host: 'collector.example:4317',
    protocol: 'grpc',
    randomSampling: true,
    policies: { requestHeaderModifier: { set: { authorization: `Bearer ${SECRET}` } } },
  })
  expect(statSync(cfgPath).mode & 0o777).toBe(0o600)
  expect(JSON.stringify(cfg().llm)).not.toContain(SECRET)
  const before = statSync(cfgPath).mtimeMs
  await new Promise((r) => setTimeout(r, 20))
  await payload.update({ collection: 'connections', id: conn.id, data: { capabilities: { verifiedAt: new Date().toISOString() } } as never, ...o })
  expect(statSync(cfgPath).mtimeMs).toBe(before)

  await payload.update({ collection: 'connections', id: conn.id, data: { config: { host: 'collector.example:4318', protocol: 'http', headerName: '' }, secret: null } as never, ...o })
  expect(cfg().frontendPolicies.tracing).toEqual({ host: 'collector.example:4318', protocol: 'http', randomSampling: true })

  await payload.delete({ collection: 'connections', id: conn.id, ...o })
  expect(cfg().frontendPolicies.tracing).toBeUndefined()
  process.env.OTEL_ENABLED = '1'
  const again = await make('otlp', { host: 'c.example:4317' })
  await payload.delete({ collection: 'connections', id: again.id, ...o })
  expect(cfg().frontendPolicies.tracing).toEqual({ host: 'jaeger:4317', randomSampling: true })
  delete process.env.OTEL_ENABLED
})

it('concurrent rewrites of config.yaml all land (queued, unique tmp names)', async () => {
  const { syncManagedConfig } = await import('../src/lib/gateway')
  writeFileSync(cfgPath, 'llm:\n  models: []\n')
  writeFileSync(join(dir, 'catalogs', 'a.json'), '{}')
  const results = await Promise.all([syncManagedConfig({ host: 'z.example:1', randomSampling: true }), syncManagedConfig(), syncManagedConfig(), syncManagedConfig({ host: 'z.example:1', randomSampling: true })])
  expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1)
  expect(cfg().frontendPolicies.tracing).toEqual({ host: 'z.example:1', randomSampling: true })
  expect(cfg().config.modelCatalog).toEqual([{ file: join(dir, 'catalogs', 'a.json') }])
  expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
})

it('boot leaves a hand-edited tracing block alone without a saved Connection', async () => {
  const { renderTracing } = await import('../src/lib/monitoring')
  const text = cfg()
  text.frontendPolicies = { tracing: { host: 'mine:4317' } }
  writeFileSync(cfgPath, JSON.stringify(text))
  await renderTracing(payload, undefined, true)
  expect(cfg().frontendPolicies.tracing).toEqual({ host: 'mine:4317' })
})

it('the test: TCP reachable or a plain refusal, Grafana health and token, no redirect followed, no secret in any message', async () => {
  const { testMonitoring } = await import('../src/lib/monitoring')
  const open = tcp().listen(0, '127.0.0.1')
  await new Promise((r) => open.once('listening', r))
  const port = (open.address() as { port: number }).port
  expect(await testMonitoring('otlp', { host: `127.0.0.1:${port}` }, null)).toMatchObject({ ok: true })
  open.close()
  await new Promise((r) => setTimeout(r, 20))
  const refused = await testMonitoring('otlp', { host: `127.0.0.1:${port}` }, SECRET)
  expect(refused).toEqual({ ok: false, message: `Cannot reach 127.0.0.1:${port} (connection refused)` })

  let hits: string[] = []
  const grafana: Server = createServer((req, res) => {
    hits.push(`${req.url} ${req.headers.authorization ?? ''}`)
    if (req.url === '/api/health') return void res.end(JSON.stringify({ database: 'ok', version: '11.2.0' }))
    if (req.url === '/api/user') return void (req.headers.authorization === `Bearer ${SECRET}` ? res.end('{}') : ((res.statusCode = 401), res.end('{}')))
    if (req.url === '/moved/api/health') return void ((res.statusCode = 302), res.setHeader('location', 'http://elsewhere.invalid/'), res.end())
    res.statusCode = 404
    res.end()
  }).listen(0, '127.0.0.1')
  await new Promise((r) => grafana.once('listening', r))
  const base = `http://127.0.0.1:${(grafana.address() as { port: number }).port}`
  expect(await testMonitoring('grafana', { url: base }, null)).toEqual({ ok: true, message: 'Grafana answered (version 11.2.0)' })
  expect(await testMonitoring('grafana', { url: base }, SECRET)).toMatchObject({ ok: true, message: expect.stringContaining('Token accepted') })
  const wrong = await testMonitoring('grafana', { url: base }, 'other-token')
  expect(wrong).toMatchObject({ ok: false, message: expect.stringContaining('did not accept the token') })
  expect(JSON.stringify(wrong)).not.toContain('other-token')
  hits = []
  const moved = await testMonitoring('grafana', { url: `${base}/moved` }, SECRET)
  expect(moved).toMatchObject({ ok: false, message: expect.stringContaining('redirected') })
  expect(hits).toEqual(['/moved/api/health '])
  expect(await testMonitoring('grafana', { url: `${base}/nope` }, null)).toMatchObject({ ok: false, message: expect.stringContaining('did not answer like Grafana') })
  grafana.close()
  await new Promise((r) => setTimeout(r, 20))
  const down = await testMonitoring('grafana', { url: base }, SECRET)
  expect(down).toEqual({ ok: false, message: `Cannot reach ${base} (connection refused)` })

  expect(await testMonitoring('grafana', { url: 'http://127.0.0.1:9' }, null)).toEqual({ ok: false, message: 'Cannot reach http://127.0.0.1:9 (that port is blocked for web requests)' })

  const hang = createServer(() => {}).listen(0, '127.0.0.1')
  await new Promise((r) => hang.once('listening', r))
  const slow = await testMonitoring('grafana', { url: `http://127.0.0.1:${(hang.address() as { port: number }).port}` }, SECRET, 100)
  expect(slow.ok).toBe(false)
  expect(slow.message).toContain('timed out')
  hang.closeAllConnections()
  hang.close()
})
