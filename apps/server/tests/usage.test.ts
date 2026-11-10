import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const o = { overrideAccess: true } as const
let payload: Payload
let usage: typeof import('../src/app/(app)/lib/usage')
let testDb: TestDb
let plain: number
let routed: number
let tokenWs: number

beforeAll(async () => {
  testDb = await createTestDb('usage_55')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'gw-'))
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  usage = await import('../src/app/(app)/lib/usage')

  plain = (await payload.create({ collection: 'workspaces', data: { name: 'plain', slug: 'plain', budgetUsd30d: 100 }, ...o })).id as number
  routed = (await payload.create({ collection: 'workspaces', data: { name: 'routed', slug: 'routed', budgetUsd30d: 100, routerKey: 'k', routerBudgetShare: 25 }, ...o })).id as number
  tokenWs = (await payload.create({ collection: 'workspaces', data: { name: 'tok', slug: 'tok', budgetUnit: 'tokens', budgetTokens30d: 1000 }, ...o })).id as number

  await payload.create({ collection: 'connections', data: { name: 'with-secret', kind: 'llm-provider', config: { provider: 'anthropic' }, secret: 'sk-ant-TOPSECRET', workspace: plain }, ...o } as never)
  await payload.create({ collection: 'connections', data: { name: 'without-secret', kind: 'llm-provider', config: { provider: 'anthropic' }, workspace: plain }, ...o } as never)

  const seed = async (ws: number, name: string, tickets: [string, { stage: string; cost?: number; gateway?: number; reconcile?: string; ago?: number; tokens?: number }[]][]) => {
    const product = (await payload.create({ collection: 'products', data: { name, slug: name, workspace: ws }, ...o })).id as number
    let n = 0
    for (const [title, runs] of tickets) {
      const t = await payload.create({ collection: 'tickets', data: { title, externalId: `${name}-${++n}`, number: n, state: 'open', stage: 'build', product, workspace: ws }, ...o })
      for (const r of runs) {
        const run = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: r.stage, status: 'succeeded', mode: 'autonomous', workspace: ws, costEstimateUsd: r.cost, gatewayCostUsd: r.gateway, reconcileStatus: r.reconcile ?? 'matched', tokensIn: r.tokens, tokensOut: r.tokens }, ...o } as never)
        if (r.ago) await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`UPDATE runs SET created_at = now() - make_interval(days => ${r.ago}) WHERE id = ${run.id}`)
      }
    }
  }
  await seed(plain, 'web', [
    ['Alpha', [{ stage: 'plan', cost: 1, gateway: 2 }, { stage: 'build', cost: 4, gateway: 5 }]],
    ['Beta', [{ stage: 'build', cost: 3, reconcile: 'pending' }]],
    ['Old', [{ stage: 'build', gateway: 50, ago: 40 }]],
  ])
  await seed(plain, 'app', [['Gamma', [{ stage: 'review', gateway: 1.5 }, { stage: 'review', cost: 9, reconcile: 'unpriced' }]]])
  await seed(routed, 'other', [['Other', [{ stage: 'plan', gateway: 99 }]]])
  await seed(tokenWs, 'tok', [['T', [{ stage: 'plan', gateway: 1, tokens: 300 }]]])
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('loadUsage costs', () => {
  it('aggregates 30 days per Product, Ticket and stage, gateway cost first, estimates labelled', async () => {
    const { costs } = await usage.loadUsage(plain)
    expect(costs.product).toEqual([{ label: 'web', costUsd: 10, estimate: true, unpriced: 0 }, { label: 'app', costUsd: 1.5, estimate: false, unpriced: 1 }])
    expect(costs.stage).toEqual([{ label: 'build', costUsd: 8, estimate: true, unpriced: 0 }, { label: 'plan', costUsd: 2, estimate: false, unpriced: 0 }, { label: 'review', costUsd: 1.5, estimate: false, unpriced: 1 }].sort((a, b) => b.costUsd - a.costUsd))
    expect(costs.ticket.map((t) => [t.label, t.costUsd, t.estimate])).toEqual([['Alpha', 7, false], ['Beta', 3, true], ['Gamma', 1.5, false]])
    expect(costs.ticket[0]).toMatchObject({ number: 1 })
  })

  it('keeps only the 20 most expensive Tickets', async () => {
    const product = (await payload.create({ collection: 'products', data: { name: 'many', slug: 'many', workspace: plain }, ...o })).id as number
    for (let i = 1; i <= 22; i++) {
      const t = await payload.create({ collection: 'tickets', data: { title: `m${i}`, externalId: `m${i}`, number: 100 + i, state: 'open', stage: 'build', product, workspace: plain }, ...o })
      await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: plain, gatewayCostUsd: 1000 + i, reconcileStatus: 'matched' }, ...o } as never)
    }
    const { costs } = await usage.loadUsage(plain)
    expect(costs.ticket).toHaveLength(20)
    expect(costs.ticket[0]!.label).toBe('m22')
  })
})

describe('loadUsage budget and provider', () => {
  it('shows one bar without a router and two (Direct, Auto) plus the total with one', async () => {
    expect((await usage.loadUsage(plain)).bars.map((b) => b.label)).toEqual(['Workspace'])
    const { bars } = await usage.loadUsage(routed)
    expect(bars.map((b) => [b.label, b.limit])).toEqual([['Total', 100], ['Direct', 75], ['Auto', 25]])
  })

  it('counts tokens instead of USD in token mode', async () => {
    const { unit, bars } = await usage.loadUsage(tokenWs)
    expect(unit).toBe('tokens')
    expect(bars).toEqual([{ label: 'Workspace', spent: 600, limit: 1000 }])
  })

  it('reports whether a secret is set and the tier mapping, and never the secret', async () => {
    const u = await usage.loadUsage(plain)
    expect(u.providers.map((p) => [p.name, p.secret])).toEqual([['with-secret', 'set'], ['without-secret', 'not set']])
    expect(u.tiers.map((t) => t.tier)).toEqual(['cheap', 'standard', 'strong'])
    expect(u.tiers.every((t) => t.model.length > 0)).toBe(true)
    expect(JSON.stringify(u)).not.toMatch(/TOPSECRET|sk-ant/)
  })
})
