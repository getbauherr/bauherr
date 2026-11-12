import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
let dir: string
const o = { overrideAccess: true } as const

beforeAll(async () => {
  testDb = await createTestDb('prices')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'prices-'))
  process.env.GATEWAY_CONFIG_DIR = dir
  delete process.env.BAUHERR_PRICES_REFRESH
  delete process.env.BAUHERR_PRICES_URL
  await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`DELETE FROM "instance_state"`)
})

/** A source catalog with `n` filler models plus the tricky shapes of the published one. */
const source = (n = 400, extra: Record<string, unknown> = {}, generatedAt = '2026-11-10T00:00:00Z') => ({
  metadata: { generatedAt },
  providers: {
    anthropic: {
      models: {
        'claude-new-1': { name: 'Claude New 1', released: '2026-11-09', rates: { input: '8', output: '40', cacheRead: '0.2', cacheWrite: '10', cacheWriteDetails: { '1h': '16', '5d': '99' } }, tiers: [{ serviceTier: 'fast', rates: { input: '16', output: '80' } }, { contextOver: 200000, rates: { input: '16', output: '60' } }, { serviceTier: 'flex', rates: { input: '4', output: '20' } }], capabilities: { weird: true } },
        ...extra,
      },
    },
    filler: { models: Object.fromEntries(Array.from({ length: n }, (_, i) => [`m-${i}`, { name: `M ${i}`, rates: { input: '1', output: '2' } }])) },
  },
})
const answer = (body: unknown, init: ResponseInit = {}) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, ...init })) as unknown as typeof fetch

it('the converter keeps name, text rates and understood tiers, and drops what the pinned gateway would refuse', async () => {
  const { convertCatalog } = await import('../src/lib/prices')
  const { catalog, list } = convertCatalog(source())
  const m = catalog.providers.anthropic!.models['claude-new-1']!
  expect(m).toEqual({
    name: 'Claude New 1',
    rates: { input: '8', output: '40', cacheRead: '0.2', cacheWrite: '10', cacheWriteDetails: { '1h': '16' } },
    tiers: [{ contextOver: 200000, rates: { input: '16', output: '60' } }, { serviceTier: 'flex', rates: { input: '4', output: '20' } }],
  })
  expect(JSON.stringify(catalog)).not.toMatch(/fast|capabilities|released|weird/)
  expect(catalog.metadata.generatedAt).toBe('2026-11-10T00:00:00Z')
  expect(list).toHaveLength(401)
})

it('the converter skips malformed entries and rejects a body that is no catalog', async () => {
  const { convertCatalog } = await import('../src/lib/prices')
  const bad = { metadata: { generatedAt: '2026-11-10T00:00:00Z' }, providers: { x: { models: { ok: { rates: { input: '1', output: '2' } }, 'bad name!': { rates: { input: '1', output: '2' } }, norates: { name: 'n' }, huge: { rates: { input: '99999999', output: '1' } }, neg: { rates: { input: '-1', output: '1' } }, str: 'x' } }, '__proto__': { models: { evil: { rates: { input: '1', output: '1' } } } } } }
  const { catalog } = convertCatalog(JSON.parse(JSON.stringify(bad).replace('"__proto__"', '"__proto__"')))
  expect(Object.keys(catalog.providers.x!.models)).toEqual(['ok'])
  expect(({} as Record<string, unknown>).evil).toBeUndefined()
  expect(() => convertCatalog('x')).toThrow(/not a model catalog/)
  expect(() => convertCatalog({ providers: {} })).toThrow(/generatedAt/)
})

it('the guards refuse too few models, a big drop and an implausible price move; a normal update passes', async () => {
  const { convertCatalog, refusal } = await import('../src/lib/prices')
  const c = (n: number, extra = {}) => convertCatalog(source(n, extra)).catalog
  expect(refusal(undefined, c(50))).toMatch(/only 51 models/)
  expect(refusal(undefined, c(400))).toBeNull()
  expect(refusal(c(1000), c(400))).toMatch(/dropped from 1001 to 401/)
  expect(refusal(c(400), c(400, { 'claude-new-1': { rates: { input: '800', output: '40' } } }))).toMatch(/moved by more than 10x for anthropic\/claude-new-1/)
  expect(refusal(c(400), c(400, { 'claude-new-1': { rates: { input: '0.4', output: '40' } } }))).toMatch(/moved by more than 10x/)
  expect(refusal(c(400), c(380, { 'claude-new-1': { rates: { input: '9', output: '41' } } }))).toBeNull()
})

it('a refresh writes the base catalog atomically, stores status and model list, lists the file and reprices unpriced usage', async () => {
  const { refreshPrices, loadPriceStatus, loadModelList } = await import('../src/lib/prices')
  const { reloadCatalog, priceOf } = await import('../src/lib/cost')
  writeFileSync(join(dir, 'config.yaml'), 'config: {}\nllm: {models: []}\n')
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'p', slug: 'p' }, ...o })).id
  await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`INSERT INTO "usage_entries" ("workspace_id", "model", "tokens_in", "tokens_out", "cache_read", "cache_write", "cost_usd", "source", "at") VALUES (${ws}, 'claude-new-1', 1000000, 100000, 0, 0, NULL, 'gateway', now()), (${ws}, 'claude-new-1', 1000000, 0, 0, 0, 9, 'gateway', now())`)
  reloadCatalog()
  expect(priceOf('claude-new-1', { tokensIn: 1e6, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull()
  const urls: string[] = []
  const status = await refreshPrices(payload, { fetcher: (async (u: unknown) => (urls.push(String(u)), new Response(JSON.stringify(source()), { status: 200 }))) as typeof fetch })
  expect(urls).toEqual(['https://agentgateway.dev/model-catalog'])
  expect(status).toMatchObject({ source: 'agentgateway.dev', generatedAt: '2026-11-10T00:00:00Z', models: 401, error: null })
  expect(JSON.parse(readFileSync(join(dir, 'catalogs', 'base-costs.json'), 'utf8')).metadata.generatedAt).toBe('2026-11-10T00:00:00Z')
  expect(existsSync(join(dir, 'catalogs', 'base-costs.json.tmp'))).toBe(false)
  expect(readFileSync(join(dir, 'config.yaml'), 'utf8')).toContain('base-costs.json')
  expect(await loadPriceStatus(payload)).toMatchObject({ models: 401 })
  expect((await loadModelList(payload)).find((m) => m.id === 'claude-new-1')).toEqual({ provider: 'anthropic', id: 'claude-new-1', name: 'Claude New 1', deprecated: false })
  const rows = (await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`SELECT "cost_usd"::float8 AS c FROM "usage_entries" WHERE "workspace_id" = ${ws} ORDER BY "id"`)).rows as { c: number }[]
  expect(rows.map((r) => r.c)).toEqual([12, 9])
})

it('a bad answer keeps the previous file and reports the error; a daily pace skips a fresh status and Update now forces', async () => {
  const { refreshPrices } = await import('../src/lib/prices')
  const ok = await refreshPrices(payload, { fetcher: answer(source()) })
  expect(ok?.error).toBeNull()
  const before = readFileSync(join(dir, 'catalogs', 'base-costs.json'), 'utf8')
  let calls = 0
  const counting = (f: typeof fetch) => (async (...a: Parameters<typeof fetch>) => (calls++, f(...a))) as typeof fetch
  expect((await refreshPrices(payload, { fetcher: counting(answer(source(100))) }))?.error).toBeNull()
  expect(calls).toBe(0)
  const bad = await refreshPrices(payload, { force: true, fetcher: counting(answer(source(100))) })
  expect(bad?.error?.message).toMatch(/only 101 models/)
  expect(bad).toMatchObject({ models: 401, generatedAt: '2026-11-10T00:00:00Z' })
  expect(readFileSync(join(dir, 'catalogs', 'base-costs.json'), 'utf8')).toBe(before)
  for (const f of [answer('<html>', {}), answer('{}', { status: 500 }), (async () => { throw new Error('boom') }) as unknown as typeof fetch]) {
    expect((await refreshPrices(payload, { force: true, fetcher: f }))?.error).toBeTruthy()
  }
  expect(readFileSync(join(dir, 'catalogs', 'base-costs.json'), 'utf8')).toBe(before)
})

it('an oversized answer is refused and BAUHERR_PRICES_REFRESH=0 switches the fetch off', async () => {
  const { refreshPrices } = await import('../src/lib/prices')
  const big = await refreshPrices(payload, { force: true, fetcher: answer('x'.repeat(5_000_001)) })
  expect(big?.error?.message).toMatch(/larger than/)
  process.env.BAUHERR_PRICES_REFRESH = '0'
  let calls = 0
  await refreshPrices(payload, { force: true, fetcher: (async () => (calls++, new Response('{}'))) as unknown as typeof fetch })
  expect(calls).toBe(0)
})

it('the price lookup reads the refreshed base over the shipped one, and overlays without metadata win over both', async () => {
  const { reloadCatalog, priceOf } = await import('../src/lib/cost')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(dir, 'catalogs'), { recursive: true })
  const model = (input: string) => ({ providers: { anthropic: { models: { 'claude-x': { rates: { input, output: '10' } } } } } })
  writeFileSync(join(dir, 'catalogs', 'a-old.json'), JSON.stringify({ metadata: { generatedAt: '2026-01-01T00:00:00Z' }, ...model('1') }))
  writeFileSync(join(dir, 'catalogs', 'base-costs.json'), JSON.stringify({ metadata: { generatedAt: '2026-11-01T00:00:00Z' }, ...model('2') }))
  reloadCatalog()
  const u = { tokensIn: 1e6, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }
  expect(priceOf('claude-x', u)).toBe(2)
  writeFileSync(join(dir, 'catalogs', 'z-overlay.json'), JSON.stringify(model('5')))
  reloadCatalog()
  expect(priceOf('claude-x', u)).toBe(5)
})
