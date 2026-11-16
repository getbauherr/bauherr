import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { EXPEDITE_LABEL } from '../src/lib/needs-you'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let liveness: typeof import('../src/lib/liveness')
let expedite: typeof import('../src/lib/expedite')
let call: (actor: unknown, name: string, input: unknown) => Promise<any>
let agent: { kind: 'agent'; keyId: number | string }
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('fast_lane_hold')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  liveness = await import('../src/lib/liveness')
  expedite = await import('../src/lib/expedite')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  const member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'admin', tenants: [{ tenant: ws }] }, ...o })
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (actor, name, input) => callTool({ payload, user: member, actor: actor as never }, name, input)
  const { mintAgentKey, resolveAgentKey } = await import('../src/lib/api-key')
  agent = { kind: 'agent', keyId: (await resolveAgentKey(payload, await mintAgentKey(payload, member as never, 'lane')))!.keyId }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const comments = async (n: number) => (await fake.tickets(repo).listComments(String(n))).map((c) => c.body)

/** A flagged Ticket; `stage` puts it in flight (a clean review waiting for a human merge for an hour when 'review'). */
const flagged = async (title: string, stage?: 'review') => {
  const i = await fake.tickets(repo).create({ title, labels: [EXPEDITE_LABEL, ...(stage ? [`bauherr:stage:${stage}`] : [])] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(i.number), number: i.number, url: i.url, state: 'open', labels: [EXPEDITE_LABEL], expedite: true, product, workspace: ws, rank: title, ...(stage && { stage, reviewState: 'ready_for_human', reviewWaitingSince: new Date(Date.now() - 3600_000).toISOString() }) }, ...o })
  return { id: t.id as number, n: i.number as number }
}

it('a parked expedite holder yields to the second Ticket within one poll (already the poller\'s duty)', async () => {
  const holder = await flagged('parked')
  await payload.update({ collection: 'tickets', id: holder.id, data: { stage: 'build', needsYou: 'Run needs you' }, ...o })
  const hot = await flagged('hot')
  await expedite.startExpedites(payload)
  expect((await reload(hot.id)).stage).toBe('plan')
  expect((await reload(holder.id)).expediteYieldedTo).toBe(hot.id)
})

it('a holder that waits for a human merge is found as fast-lane-held; release_fast_lane drops the flag with one Comment and the second Ticket enters', async () => {
  const holder = await flagged('stalled', 'review')
  const hot = await flagged('hot 2')
  await expedite.startExpedites(payload)
  expect((await reload(hot.id)).stage ?? null).toBeNull()
  await liveness.sweepLiveness(payload)
  expect((await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === holder.id)?.cause).toBe('fast-lane-held')
  expect((await reload(holder.id)).liveness).toMatchObject({ cause: 'fast-lane-held', need: null })
  await expect(call(agent, 'release_fast_lane', { ticket: hot.id })).rejects.toThrow(/nothing to release/)
  expect(await call(agent, 'release_fast_lane', { ticket: holder.id })).toEqual({ outcome: 'released' })
  expect(await reload(holder.id)).toMatchObject({ expedite: false })
  expect((await fake.tickets(repo).get(String(holder.n))).labels).not.toContain(EXPEDITE_LABEL)
  expect((await comments(holder.n)).filter((c) => c.includes('gave up its place'))).toHaveLength(1)
  await expedite.startExpedites(payload)
  expect((await reload(hot.id)).stage).toBe('plan')
  await liveness.sweepLiveness(payload)
  expect((await reload(holder.id)).liveness).toMatchObject({ cause: 'review-stalled' })
})

it('a hold nobody cleared becomes exactly one Inbox decision, and none once released', async () => {
  const holder = await flagged('stuck', 'review')
  await flagged('waits')
  const { syncGates } = await import('../src/lib/gates')
  const held = async () => ((await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: ws } }, { needsYou: { equals: 'Fast lane held' } }] }, depth: 0, ...o })).docs as Record<string, any>[]).map((t) => t.id)
  await liveness.sweepLiveness(payload)
  await syncGates(payload)
  expect(await held()).toEqual([])
  const found = (await reload(holder.id)).liveness
  await payload.update({ collection: 'tickets', id: holder.id, data: { liveness: { ...found, since: new Date(Date.now() - 3600_000).toISOString() } }, ...o } as never)
  for (let i = 0; i < 2; i++) {
    await liveness.sweepLiveness(payload)
    await syncGates(payload)
  }
  expect(await held()).toEqual([holder.id])
  expect((await reload(holder.id)).decision).toMatchObject({ need: 'Fast lane held', checkpoint: 'Stuck', options: [{ action: 'releaseLane' }, { action: 'open' }] })
  await expedite.releaseFastLane(payload, await reload(holder.id))
  await liveness.sweepLiveness(payload)
  await syncGates(payload)
  expect(await held()).toEqual([])
})
