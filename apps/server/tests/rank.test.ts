import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { evenRanks } from '../src/lib/frontier'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let member: Record<string, any>
let product: number
let otherProduct: number
let ws: number
let other: number
let n = 0
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('rank')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  otherProduct = (await payload.create({ collection: 'products', data: { name: 'api', slug: 'api', workspace: other }, ...o })).id as number
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const seed = async (rank: string | null, workspace = ws) => (await payload.create({ collection: 'tickets', data: { title: `t-${rank}`, externalId: `r-${++n}`, number: n, state: 'open', labels: [], stage: 'build', product: workspace === ws ? product : otherProduct, workspace, rank }, ...o })).id as number
const reset = () => payload.delete({ collection: 'tickets', where: { workspace: { in: [ws, other] } }, ...o })
const order = async (workspace = ws) => (await payload.find({ collection: 'tickets', where: { workspace: { equals: workspace } }, sort: 'number', pagination: false, ...o })).docs.sort((a, b) => ((a.rank as string) < (b.rank as string) ? -1 : 1)).map((t) => t.id as number)
const rankOf = async (id: number) => (await payload.findByID({ collection: 'tickets', id, ...o })).rank as string

it('evenRanks gives ascending keys of one short length, with room before the first', () => {
  for (const count of [1, 5, 500, 100_000]) {
    const keys = evenRanks(count)
    expect(keys).toHaveLength(count)
    expect(keys.every((k) => k.length === keys[0].length && k.length <= 5)).toBe(true)
    expect([...keys].sort()).toEqual(keys)
    expect(new Set(keys).size).toBe(count)
    expect(keys[0] > '0'.repeat(keys[0].length)).toBe(true)
  }
})

it('top and bottom place a Ticket first and last', async () => {
  await reset()
  const [a, b, c] = [await seed('b'), await seed('c'), await seed('d')]
  await actions.rankTicket(payload, member, { ticket: c, before: null, after: a, workspaceId: ws })
  expect(await order()).toEqual([c, a, b])
  await actions.rankTicket(payload, member, { ticket: c, before: b, after: null, workspaceId: ws })
  expect(await order()).toEqual([a, b, c])
})

it('move up and down swap with the neighbour two steps away', async () => {
  await reset()
  const [a, b, c, d] = [await seed('b'), await seed('c'), await seed('d'), await seed('e')]
  await actions.rankTicket(payload, member, { ticket: c, before: a, after: b, workspaceId: ws })
  expect(await order()).toEqual([a, c, b, d])
  await actions.rankTicket(payload, member, { ticket: c, before: b, after: d, workspaceId: ws })
  expect(await order()).toEqual([a, b, c, d])
})

it('rankFirst puts the Ticket below every rank, also when the lowest is all zeros, and refuses another Workspace', async () => {
  await reset()
  const [a, b] = [await seed('000000'), await seed('m')]
  await actions.rankFirst(payload, member, { ticket: b, workspaceId: ws })
  expect(await order()).toEqual([b, a])
  const c = await seed('z')
  await actions.rankFirst(payload, member, { ticket: c, workspaceId: ws })
  expect(await order()).toEqual([c, b, a])
  await expect(actions.rankFirst(payload, member, { ticket: a, workspaceId: other })).rejects.toBeInstanceOf(actions.NotInWorkspace)
})

it('a rank that would pass 12 characters rebalances the Workspace, keeping the order and not touching others', async () => {
  await reset()
  const long = 'z'.repeat(12)
  const [a, b, c] = [await seed('a'), await seed(long), await seed(`${long}k`)]
  const elsewhere = await seed('q', other)
  await actions.rankTicket(payload, member, { ticket: a, before: c, after: null, workspaceId: ws })
  expect(await order()).toEqual([b, c, a])
  for (const id of [a, b, c]) expect((await rankOf(id)).length).toBeLessThanOrEqual(actions.MAX_RANK_LENGTH)
  expect(await rankOf(elsewhere)).toBe('q')
})
