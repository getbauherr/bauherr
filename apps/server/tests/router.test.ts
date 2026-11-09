import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import { tierModels } from '../src/lib/run-ctx'
import { decrypt } from '../src/lib/secrets'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const o = { overrideAccess: true } as const
const dir = mkdtempSync(join(tmpdir(), 'router-'))
const cfgPath = join(dir, 'router', 'config.yaml')

type Res = { id: string; value: { key: string; allowedModels: string[]; metadata: { name: string } } }
let store: Res[] = []
const fakeGateway = async (url: string, init?: { method?: string; body?: string }) => {
  const id = url.split('/').pop()!
  const body = init?.body ? JSON.parse(init.body) : undefined
  if (init?.method === 'PUT' && body.resources) store.push(...body.resources.map((r: { value: Res['value'] }) => ({ id: `k${store.length + 1}`, value: r.value })))
  else if (init?.method === 'PUT') store = store.map((r) => (r.id === id ? { id, value: body.value } : r))
  else if (init?.method === 'DELETE') store = store.filter((r) => r.id !== id)
  return { ok: true, json: async () => ({ resources: store }) }
}

const conn = (workspace: number, provider: string) =>
  payload.create({ collection: 'connections', data: { name: provider, kind: 'llm-provider', provider, secret: 'dummy-key', workspace } as never, ...o })
const ws = async (slug: string) => (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id as number
const load = (id: number) => payload.findByID({ collection: 'workspaces', id, ...o }) as unknown as Promise<{ slug: string; gatewayKey: string; routerKey?: string | null; modelByTier: Record<string, string>; budgetUnit: string }>
const routerKeys = () => store.filter((r) => r.value.metadata.name.endsWith('-router'))

beforeAll(async () => {
  testDb = await createTestDb('router_58')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_CONFIG_DIR = dir
  delete process.env.GATEWAY_URL
  mkdirSync(join(dir, 'providers'))
  writeFileSync(join(dir, 'config.yaml'), 'llm:\n  models: []\n')
  vi.stubGlobal('fetch', fakeGateway)
  process.env.GATEWAY_ADMIN_URL = 'http://gw.invalid'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.GATEWAY_ADMIN_URL
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('a router Connection adds tier auto, one router key and a 0600 router config; tiers and budget stay; the last Connection revokes all', async () => {
  const w = await ws('rt')
  await conn(w, 'anthropic')
  const before = await load(w)
  expect(await tierModels(payload, before)).not.toHaveProperty('auto')

  const router = await conn(w, 'router')
  const after = await load(w)
  expect(after.modelByTier).toEqual(before.modelByTier)
  expect(after.budgetUnit).toBe(before.budgetUnit)
  const tiers = await tierModels(payload, after)
  expect(tiers.auto).toBe('ws-rt/router/auto')

  const keys = routerKeys()
  expect(keys).toHaveLength(1)
  const tierIds = [tiers.cheap, tiers.standard, tiers.strong]
  expect(keys[0]!.value.allowedModels).toEqual(tierIds)
  expect(keys[0]!.value.allowedModels.some((m) => m.endsWith('/auto'))).toBe(false)
  expect(keys[0]!.value.key).toBe(decrypt(after.routerKey!))

  const text = readFileSync(cfgPath, 'utf8')
  expect(statSync(cfgPath).mode & 0o777).toBe(0o600)
  for (const id of tierIds) expect(text).toContain(id)
  expect(text).toContain(keys[0]!.value.key)
  expect(text).not.toContain(decrypt(after.gatewayKey))
  const cfg = parse(text)
  expect(cfg.global.router.auto_model_names).toEqual(['auto'])
  expect(cfg.providers.models.every((m: { backend_refs: { endpoint: string }[] }) => m.backend_refs[0]!.endpoint === 'gateway:4000')).toBe(true)

  await payload.update({ collection: 'workspaces', id: w, data: { budgetUsd30d: 99 }, ...o })
  expect(routerKeys()).toHaveLength(1)
  expect(routerKeys()[0]!.value.key).toBe(keys[0]!.value.key)

  await payload.delete({ collection: 'connections', id: router.id, ...o })
  expect(routerKeys()).toHaveLength(0)
  expect(existsSync(cfgPath)).toBe(false)
  expect((await load(w)).routerKey).toBeFalsy()
  expect(await tierModels(payload, await load(w))).not.toHaveProperty('auto')
})

it('changing the preset away from router revokes the router key and removes the router config', async () => {
  const w = await ws('rt-away')
  await conn(w, 'anthropic')
  const router = await conn(w, 'router')
  expect(routerKeys()).toHaveLength(1)
  await payload.update({ collection: 'connections', id: router.id, data: { provider: 'anthropic', secret: 'dummy-key' } as never, ...o })
  expect(routerKeys()).toHaveLength(0)
  expect((await load(w)).routerKey).toBeFalsy()
  expect(existsSync(cfgPath)).toBe(false)
})

it('a tier value ending in /auto is rejected, also for a router-only Workspace', async () => {
  const w = await ws('rt-auto')
  const router = await conn(w, 'router')
  for (const v of ['router/auto', 'auto']) {
    await expect(payload.update({ collection: 'workspaces', id: w, data: { modelByTier: { cheap: v, standard: v, strong: v } }, ...o })).rejects.toThrow(/invalid: (cheap|standard|strong)/)
  }
  await payload.delete({ collection: 'connections', id: router.id, ...o })
})

it('a second Workspace with a router Connection is rejected', async () => {
  const a = await ws('rt-a')
  const b = await ws('rt-b')
  await conn(a, 'router')
  await expect(conn(b, 'router')).rejects.toThrow(/invalid: provider/)
})

it('the gateway code never compares against the router enum value in SQL: older migrations render the gateway before that value exists', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/lib/gateway.ts', import.meta.url), 'utf8')
  expect(src).not.toMatch(/provider:\s*\{\s*(equals|not_equals|in|not_in):\s*\[?\s*'router'/)
})
