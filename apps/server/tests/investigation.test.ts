import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let liveness: typeof import('../src/lib/liveness')
let wip: typeof import('../src/lib/wip')
let inv: typeof import('../src/lib/investigation')
let call: (actor: unknown, name: string, input: unknown) => Promise<any>
let agent: { kind: 'agent'; keyId: number | string }
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const MARKER = '<!-- bauherr:investigation -->'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('investigation')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  liveness = await import('../src/lib/liveness')
  wip = await import('../src/lib/wip')
  inv = await import('../src/lib/investigation')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (actor, name, input) => callTool({ payload, user: member, actor: actor as never }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'admin', tenants: [{ tenant: ws }] }, ...o })
  const keys = await import('../src/lib/api-key')
  agent = { kind: 'agent', keyId: (await keys.resolveAgentKey(payload, await keys.mintAgentKey(payload, member as never, 'investigation')))!.keyId }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, sort: 'id', depth: 0, ...o })).docs as Record<string, any>[]
const comment = async (n: string) => (await fake.tickets(repo).listComments(n)).map((c) => c.body).find((b) => b.startsWith(MARKER)) ?? ''

/** A Build Ticket whose latest Build Run failed after a first failure: one sweep from the second failure. */
const seedTwiceFailed = async () => {
  const issue = await fake.tickets(repo).create({ title: 'stuck', labels: ['bauherr:stage:build'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'stuck', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })
  const first = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'failed', mode: 'session', workspace: ws, error: 'Reached maximum number of turns (20)' }, ...o })
  const second = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'failed', mode: 'session', workspace: ws, previousRun: first.id, error: 'Reached maximum number of turns (20)' }, ...o })
  return { id: t.id as number, n: String(issue.number), first, second }
}

/** Claims the investigation Plan Run as a session and returns its lease. */
const claim = async (id: number) => {
  const r = (await runs(id, 'plan'))[0]!
  await payload.update({ collection: 'runs', where: { and: [{ status: { equals: 'awaiting_session' } }, { id: { not_equals: r.id } }] }, data: { status: 'cancelled' }, ...o })
  const got = await call(agent, 'claim_run', { runId: r.id })
  return { runId: r.id, leaseToken: got.leaseToken as string, claimed: got }
}

it('a second Build failure moves the Ticket to Plan with the reason and queues one escalated investigation Run', async () => {
  const { id, n, first, second } = await seedTwiceFailed()
  expect(await liveness.sweepLiveness(payload)).toBeGreaterThanOrEqual(1)
  expect(await reload(id)).toMatchObject({ stage: 'plan', waitingFor: null, waitingReason: 'failed twice: investigate' })
  expect((await fake.tickets(repo).get(n)).labels).toContain('bauherr:stage:plan')
  const plan = await runs(id, 'plan')
  expect(plan).toHaveLength(1)
  expect(plan[0]).toMatchObject({ status: 'awaiting_session', investigation: { failedRuns: [first.id, second.id], stage: 'build' } })
  const body = await comment(n)
  expect(body).toContain(`Run #${first.id}`)
  expect(body).toContain(`Run #${second.id}`)
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'plan')).toHaveLength(1)
  const { runId, claimed } = await claim(id)
  expect(runId).toBe(plan[0]!.id)
  expect(claimed.run.tier).toBe('strong')
})

it('fix-ticket files a bug, sets blocked-by, and a fresh strong Build Run starts once the fix is closed', async () => {
  const { id, n } = await seedTwiceFailed()
  await liveness.sweepLiveness(payload)
  const { runId, leaseToken } = await claim(id)
  const res = await call(agent, 'submit_investigation', { runId, leaseToken, cause: 'turn cap too low', decision: 'fix-ticket', fix: { title: 'Raise the turn cap', body: 'cap is 20' }, model: 'm-strong' })
  const fixNumber = res.fix.number as number
  expect((await fake.tickets(repo).get(String(fixNumber))).labels).toContain('type:bug')
  expect((await fake.tickets(repo).get(n)).blockedBy).toContain(String(fixNumber))
  const fixDoc = (await payload.find({ collection: 'tickets', where: { number: { equals: fixNumber } }, limit: 1, ...o })).docs[0]!
  expect(await reload(id)).toMatchObject({ stage: 'plan', waitingFor: 'build', blockedBy: [fixDoc.id] })
  const body = await comment(n)
  expect(body).toContain('turn cap too low')
  expect(body).toContain(`#${fixNumber}`)
  expect(body).toContain('tier strong, model m-strong')
  await call(agent, 'finish_run', { runId, leaseToken, status: 'succeeded' })
  await expect(call(agent, 'submit_investigation', { runId, leaseToken, cause: 'x', decision: 'revise' })).rejects.toThrow()

  await wip.pullWaiting(payload)
  expect(await runs(id, 'build')).toHaveLength(2)
  await payload.update({ collection: 'tickets', id: fixDoc.id, data: { state: 'closed' }, ...o })
  await wip.pullWaiting(payload)
  const builds = await runs(id, 'build')
  expect(builds).toHaveLength(3)
  expect(builds[2]).toMatchObject({ status: 'awaiting_session', previousRun: null })
  expect(await reload(id)).toMatchObject({ stage: 'build' })
  expect(await inv.isEscalated(payload, builds[2]!)).toBe(true)
  expect((await call(agent, 'claim_run', { runId: builds[2]!.id })).run.tier).toBe('strong')
  expect(await comment(n)).toContain(`Build Run #${builds[2]!.id} on tier strong (400 turns, $10)`)
  expect(await inv.isEscalated(payload, builds[0]!)).toBe(false)
})

it('a failure of the fresh Build Run is a first failure: it gets one successor, then the second investigation', async () => {
  const { id } = await seedTwiceFailed()
  await liveness.sweepLiveness(payload)
  const { runId, leaseToken } = await claim(id)
  await call(agent, 'submit_investigation', { runId, leaseToken, cause: 'c1', decision: 'revise' })
  await call(agent, 'finish_run', { runId, leaseToken, status: 'succeeded' })
  expect((await fake.tickets(repo).get((await reload(id)).externalId)).labels).not.toContain('bauherr:approved:plan')
  const fresh = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'failed', mode: 'session', workspace: ws, error: 'again' }, ...o })
  await payload.update({ collection: 'tickets', id, data: { stage: 'build' }, ...o })
  await liveness.sweepLiveness(payload)
  const builds = await runs(id, 'build')
  expect(builds).toHaveLength(4)
  expect(builds[3]).toMatchObject({ previousRun: fresh.id })
  expect(await runs(id, 'plan')).toHaveLength(1)
  await payload.update({ collection: 'runs', id: builds[3]!.id, data: { status: 'failed', error: 'and again' }, ...o })
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'plan')).toHaveLength(2)
  expect(await reload(id)).toMatchObject({ stage: 'plan' })
})

it('the third investigation is not queued: the failure stays with the owner', async () => {
  const { id } = await seedTwiceFailed()
  for (const status of ['succeeded', 'succeeded']) await payload.create({ collection: 'runs', data: { ticket: id, stage: 'plan', status, mode: 'session', workspace: ws, investigation: { failedRuns: [], stage: 'build' } }, ...o })
  const third = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'failed', mode: 'session', workspace: ws, previousRun: (await runs(id, 'build'))[1]!.id, error: 'x' }, ...o })
  expect(third.id).toBeGreaterThan(0)
  await liveness.sweepLiveness(payload)
  expect(await runs(id, 'plan')).toHaveLength(2)
  expect(await reload(id)).toMatchObject({ stage: 'build' })
  expect((await liveness.deadTickets(payload, ws)).find((d) => d.ticket.id === id)).toMatchObject({ cause: 'run-failed', need: 'Run failed' })
})

it('needs-human records the question; submit_investigation refuses a Run that is not an investigation', async () => {
  const { id, n } = await seedTwiceFailed()
  await liveness.sweepLiveness(payload)
  const { runId, leaseToken } = await claim(id)
  await expect(call(agent, 'submit_investigation', { runId, leaseToken, cause: 'c', decision: 'needs-human' })).rejects.toThrow(/question/)
  await call(agent, 'submit_investigation', { runId, leaseToken, cause: 'secret missing', decision: 'needs-human', question: 'Add the deploy key?' })
  expect(await comment(n)).toContain('Question: Add the deploy key?')
  const plain = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'plan', status: 'running', mode: 'session', workspace: ws }, ...o })
  expect(await inv.isEscalated(payload, plain)).toBe(false)
})
