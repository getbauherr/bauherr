import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let admin: Record<string, any>
let member: Record<string, any>
let product: number
let ws: number
let other: number
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('repair')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ;[ws, other] = (await Promise.all(['acme', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))).map((w) => w.id as number) as [number, number]
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  admin = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const seed = async (data: Record<string, unknown> = {}) => {
  const issue = await fake.tickets(repo).create({ title: 't', labels: ['bauherr:stage:build'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws, ...data }, ...o })
  return { id: t.id as number, number: issue.number as number }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const touches = async (id: number) => (await payload.find({ collection: 'human_touches', where: { ticket: { equals: id } }, ...o })).docs.map((d) => d.kind as string).sort()

it('a non-Admin member cannot repair, and nothing changes', async () => {
  const { id } = await seed({ reviewRounds: 2, waitingFor: 'build' })
  await expect(actions.repairTicket(payload, member, { ticket: id, workspaceId: ws, repair: { kind: 'reset-counters' } })).rejects.toThrow('Only an Admin can change this.')
  await expect(actions.relinkRunMr(payload, member, { runId: 1, workspaceId: ws, prUrl: 'x' })).rejects.toThrow('Only an Admin')
  expect(await reload(id)).toMatchObject({ reviewRounds: 2, waitingFor: 'build' })
  expect(await touches(id)).toEqual([])
})

it('refuses a Ticket of another selected Workspace', async () => {
  const { id } = await seed()
  await expect(actions.repairTicket(payload, admin, { ticket: id, workspaceId: other, repair: { kind: 'clear-waiting' } })).rejects.toBeInstanceOf(actions.NotInWorkspace)
})

it('set stage moves the forge label and the stage, clears the wait and records a touch', async () => {
  const { id, number } = await seed({ waitingFor: 'review', waitingReason: 'x' })
  await actions.repairTicket(payload, admin, { ticket: id, workspaceId: ws, repair: { kind: 'stage', stage: 'review' } })
  expect(await reload(id)).toMatchObject({ stage: 'review', waitingFor: null, waitingReason: null, factoryStage: 'review' })
  expect((await fake.tickets(repo).get(String(number))).labels).toEqual(['bauherr:stage:review'])
  expect(await touches(id)).toEqual(['repair:stage'])
  await expect(actions.repairTicket(payload, admin, { ticket: id, workspaceId: ws, repair: { kind: 'stage', stage: 'bogus' as never } })).rejects.toThrow('unknown stage')
})

it('clear-waiting and reset-counters change only their fields', async () => {
  const { id } = await seed({ waitingFor: 'plan', waitingReason: 'overlaps #1', gatePendingAttempts: 3, mergeFailures: 2, releaseAttempts: 3, reviewRounds: 4, conflictReturns: 3 })
  await actions.repairTicket(payload, admin, { ticket: id, workspaceId: ws, repair: { kind: 'clear-waiting' } })
  expect(await reload(id)).toMatchObject({ waitingFor: null, waitingReason: null, reviewRounds: 4, stage: 'build' })
  await actions.repairTicket(payload, admin, { ticket: id, workspaceId: ws, repair: { kind: 'reset-counters' } })
  expect(await reload(id)).toMatchObject({ gatePendingAttempts: 0, mergeFailures: 0, releaseAttempts: 0, reviewRounds: 0, conflictReturns: 0, stage: 'build' })
  expect(await touches(id)).toEqual(['repair:clear-waiting', 'repair:reset-counters'])
})

it('rank-top puts the Ticket before every other ranked Ticket of the Workspace', async () => {
  const a = await seed({ rank: 'a0' })
  const b = await seed({ rank: 'b0' })
  await actions.repairTicket(payload, admin, { ticket: b.id, workspaceId: ws, repair: { kind: 'rank-top' } })
  const [ra, rb] = [(await reload(a.id)).rank as string, (await reload(b.id)).rank as string]
  expect(rb < ra).toBe(true)
})

it('relinkRunMr links an open factory MR to a Build Run, refuses a foreign or closed MR and a non-Build Run', async () => {
  const { id, number } = await seed()
  const open = async (n: number, suffix: string) => {
    const branch = `bauherr/${n}-${suffix}`
    await fake.forge.createBranch(repo, branch)
    fake.commit(repo, branch, `${suffix}.ts`, suffix)
    return fake.forge.openPullRequest(repo, { title: suffix, body: 'x', head: branch, base: 'main' })
  }
  const run = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: 'https://old', keep: 1 } }, ...o })
  const next = await open(number, 'next')
  const foreign = await open(9999, 'other')
  const closed = await open(number, 'closed')
  await fake.forge.closePullRequest(repo, closed.number)
  for (const prUrl of [foreign.url, closed.url, 'https://example.com/x']) await expect(actions.relinkRunMr(payload, admin, { runId: run.id as number, workspaceId: ws, prUrl })).rejects.toThrow(/open pull request/)
  await actions.relinkRunMr(payload, admin, { runId: run.id as number, workspaceId: ws, prUrl: next.url })
  expect((await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })).artifacts).toEqual({ prUrl: next.url, keep: 1 })
  expect(await touches(id)).toEqual(['repair:relink-mr'])
  const plan = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'plan', status: 'succeeded', mode: 'session', workspace: ws }, ...o })
  await expect(actions.relinkRunMr(payload, admin, { runId: plan.id as number, workspaceId: ws, prUrl: next.url })).rejects.toThrow('only a Build Run')
  await expect(actions.relinkRunMr(payload, admin, { runId: run.id as number, workspaceId: other, prUrl: next.url })).rejects.toBeInstanceOf(actions.NotInWorkspace)
})
