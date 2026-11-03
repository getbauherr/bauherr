import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { tierModels } from '../src/lib/run-ctx'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
const o = { overrideAccess: true } as const
const dir = mkdtempSync(join(tmpdir(), 'gw-'))
const conn = (workspace: number, provider: string, extra: object = {}) =>
  payload.create({ collection: 'connections', data: { name: provider, kind: 'llm-provider', provider, secret: 'dummy-key', workspace, ...extra } as never, ...o })
const ws = async (slug: string) => (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id as number
const reload = (id: number) => payload.findByID({ collection: 'workspaces', id, ...o }) as unknown as Promise<{ modelByTier: Record<string, string>; budgetUnit: string }>

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('multi_144')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_CONFIG_DIR = dir
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.GATEWAY_URL
  mkdirSync(join(dir, 'providers'))
  writeFileSync(join(dir, 'config.yaml'), 'llm:\n  models: []\n')
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('two Connections of one Workspace render two entries and files; deleting one leaves the other', async () => {
  const w = await ws('multi')
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ resources: [] }) }))
  process.env.GATEWAY_ADMIN_URL = 'http://gw.invalid'
  try {
    await conn(w, 'anthropic')
    const second = await conn(w, 'greenpt')
    const cfg = () => readFileSync(join(dir, 'config.yaml'), 'utf8')
    expect(cfg()).toContain('ws-multi/anthropic/*')
    expect(cfg()).toContain('ws-multi/greenpt/*')
    expect(existsSync(join(dir, 'providers', 'ws-multi.anthropic.key'))).toBe(true)
    expect(existsSync(join(dir, 'providers', 'ws-multi.greenpt.key'))).toBe(true)
    await payload.delete({ collection: 'connections', id: second.id, ...o })
    expect(existsSync(join(dir, 'providers', 'ws-multi.greenpt.key'))).toBe(false)
    expect(existsSync(join(dir, 'providers', 'ws-multi.anthropic.key'))).toBe(true)
    expect(cfg()).not.toContain('ws-multi/greenpt/*')
    expect(cfg()).toContain('ws-multi/anthropic/*')
  } finally {
    delete process.env.GATEWAY_ADMIN_URL
  }
})

it('connection slugs: derived from the preset, unique per Workspace, fixed after create', async () => {
  const w = await ws('slugs')
  const a = await conn(w, 'anthropic')
  const b = await conn(w, 'anthropic')
  expect([a.slug, b.slug]).toEqual(['anthropic', 'anthropic-2'])
  await expect(conn(w, 'anthropic', { slug: 'anthropic' })).rejects.toThrow(/invalid: slug/)
  await expect(conn(w, 'anthropic', { slug: 'Bad/Slug' })).rejects.toThrow(/invalid: slug/)
  await expect(payload.update({ collection: 'connections', id: a.id, data: { slug: 'other' }, ...o })).rejects.toThrow(/invalid: slug/)
  expect((await conn(await ws('slugs-2'), 'anthropic')).slug).toBe('anthropic')
})

it('tiers are <connection>/<model>, may point at different Connections, and unknown Connections are refused', async () => {
  const w = await ws('tiers')
  expect((await reload(w)).modelByTier.cheap).toBe('claude-haiku-5-5')
  await conn(w, 'anthropic')
  await conn(w, 'greenpt')
  expect(await reload(w)).toMatchObject({ modelByTier: { cheap: 'anthropic/claude-haiku-5-5', strong: 'anthropic/claude-opus-5-5' } })
  const tiers = { cheap: 'greenpt/glm-5.3-flash', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' }
  await payload.update({ collection: 'workspaces', id: w, data: { modelByTier: tiers }, ...o })
  expect((await reload(w)).modelByTier).toEqual(tiers)
  for (const bad of ['nope/x', 'claude-haiku-5-5', 'greenpt/']) {
    await expect(payload.update({ collection: 'workspaces', id: w, data: { modelByTier: { ...tiers, cheap: bad } }, ...o })).rejects.toThrow(/invalid: cheap/)
  }
})

it('budget unit is tokens while any Connection has no USD catalog, usd again when it is gone', async () => {
  const w = await ws('budget')
  await conn(w, 'anthropic')
  expect((await reload(w)).budgetUnit).toBe('usd')
  const unpriced = await conn(w, 'bedrock', { awsRegion: 'us-east-1' })
  expect((await reload(w)).budgetUnit).toBe('tokens')
  await payload.delete({ collection: 'connections', id: unpriced.id, ...o })
  expect((await reload(w)).budgetUnit).toBe('usd')
})

it('the migration backfills slugs and prefixes tiers, and running it again changes nothing', async () => {
  const w = await ws('mig')
  const [a, b] = [await conn(w, 'anthropic'), await conn(w, 'anthropic')]
  const db = (payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> } }).drizzle
  await db.execute(sql`UPDATE connections SET slug = NULL WHERE workspace_id = ${w}`)
  await db.execute(sql`UPDATE workspaces SET model_by_tier = '{"cheap":"claude-haiku-5-5","standard":"x/y","strong":"claude-opus-5-5"}'::jsonb WHERE id = ${w}`)
  const { up } = await import('../src/migrations/20261102_150144_connection_slugs')
  const state = async () => ({
    slugs: (await payload.find({ collection: 'connections', where: { workspace: { equals: w } }, sort: 'id', ...o })).docs.map((c) => c.slug),
    tiers: (await reload(w)).modelByTier,
  })
  await up({ db, payload, req: {} } as never)
  const first = await state()
  expect(first).toEqual({ slugs: ['anthropic', 'anthropic-2'], tiers: { cheap: 'anthropic/claude-haiku-5-5', standard: 'anthropic/x/y', strong: 'anthropic/claude-opus-5-5' } })
  await up({ db, payload, req: {} } as never)
  expect(await state()).toEqual(first)
  expect([a.id, b.id]).toHaveLength(2)
})

it('a Connection that tiers point at cannot be deleted; an unreferenced one can', async () => {
  const w = await ws('del-ref')
  const a = await conn(w, 'anthropic')
  const g = await conn(w, 'greenpt')
  await payload.update({ collection: 'workspaces', id: w, data: { modelByTier: { cheap: 'greenpt/glm-5.3-flash', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' } }, ...o })
  await expect(payload.delete({ collection: 'connections', id: g.id, ...o })).rejects.toThrow(/cheap/)
  expect((await reload(w)).modelByTier.cheap).toBe('greenpt/glm-5.3-flash')
  await payload.update({ collection: 'workspaces', id: w, data: { modelByTier: { cheap: 'anthropic/claude-haiku-5-5', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' } }, ...o })
  await payload.delete({ collection: 'connections', id: g.id, ...o })
  await expect(payload.delete({ collection: 'connections', id: a.id, ...o })).rejects.toThrow(/cheap, standard, strong/)
  const run = await payload.findByID({ collection: 'workspaces', id: w, ...o })
  expect(await tierModels(payload, run)).toMatchObject({ cheap: 'ws-del-ref/anthropic/claude-haiku-5-5' })
})

it('concurrent creates cannot share a slug', async () => {
  const w = await ws('race')
  const r = await Promise.allSettled([conn(w, 'anthropic', { slug: 'same' }), conn(w, 'anthropic', { slug: 'same' })])
  expect(r.map((x) => x.status).sort()).toEqual(['fulfilled', 'rejected'])
})

it('missing tiers resolve to the Workspace Connection slug, or fail the Run without one', async () => {
  const w = await ws('tiers-missing')
  const db = (payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> } }).drizzle
  await db.execute(sql`UPDATE workspaces SET model_by_tier = '{"strong":"x/y"}'::jsonb WHERE id = ${w}`)
  const load = () => payload.findByID({ collection: 'workspaces', id: w, ...o })
  await expect(tierModels(payload, await load())).rejects.toThrow(/no LLM provider Connection/)
  await conn(w, 'anthropic')
  await db.execute(sql`UPDATE workspaces SET model_by_tier = '{"strong":"anthropic/y"}'::jsonb WHERE id = ${w}`)
  expect(await tierModels(payload, await load())).toEqual({ cheap: 'ws-tiers-missing/anthropic/claude-haiku-5-5', standard: 'ws-tiers-missing/anthropic/claude-sonnet-5-5', strong: 'ws-tiers-missing/anthropic/y' })
})

it('the migration fills missing tiers for a Workspace with exactly one Connection', async () => {
  const w = await ws('mig-fill')
  await conn(w, 'anthropic')
  const db = (payload.db as unknown as { drizzle: { execute: (q: unknown) => Promise<unknown> } }).drizzle
  await db.execute(sql`UPDATE workspaces SET model_by_tier = '{"cheap":"claude-haiku-5-5"}'::jsonb WHERE id = ${w}`)
  const { up } = await import('../src/migrations/20261102_150144_connection_slugs')
  await up({ db, payload, req: {} } as never)
  expect((await reload(w)).modelByTier).toEqual({ cheap: 'anthropic/claude-haiku-5-5', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5' })
})
