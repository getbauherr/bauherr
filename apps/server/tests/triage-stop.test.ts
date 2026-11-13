import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const exec = vi.hoisted(() => vi.fn())
vi.mock('@bauherr/runner', async (orig) => ({ ...(await orig<typeof import('@bauherr/runner')>()), runStage: exec }))

let payload: Payload
let fake: FakeBackend
let jobs: typeof import('../src/jobs')
let connection: number
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 }

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('triage_stop')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_URL = 'http://gateway.test'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await poll()
  await drain()
})

beforeEach(() => {
  exec.mockReset()
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const drain = async () => {
  while (await jobs.triageSweep(payload)) {}
}
const create = async (title: string, labels: string[] = []) => {
  const issue = await fake.tickets(repo).create({ title, labels })
  await poll()
  const t = (await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>
  return { n: String(issue.number), id: t.id as number }
}
const runs = async (ticket: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket } }, { stage: { equals: stage } }] }, sort: 'createdAt', depth: 0, ...o })).docs as Record<string, any>[]
const runLatest = async (ticket: number, stage: string) => {
  const run = (await runs(ticket, stage)).at(-1)!
  await (jobs.runStage.handler as (a: unknown) => Promise<unknown>)({ input: { runId: run.id }, req: { payload } })
}
const comments = async (n: string) => (await fake.tickets(repo).listComments(n)).map((c) => c.body)
const gaveUp = async (n: string) => (await comments(n)).filter((c) => c.includes('triage failed 3 times'))

for (const status of ['budget_exhausted', 'needs_human'] as const) {
  it(`a triage Run that ends ${status} posts no Comment and counts as an attempt; after 3 the Ticket is given up once`, async () => {
    exec.mockResolvedValue({ status, reason: 'stopped', artifacts: {}, usage })
    await drain()
    const t = await create(`stopped ${status}`)
    for (let i = 0; i < 3; i++) {
      expect(await runs(t.id, 'triage')).toHaveLength(i + 1)
      await runLatest(t.id, 'triage')
      await poll()
      await drain()
    }
    expect(await runs(t.id, 'triage')).toHaveLength(3)
    expect(await comments(t.n)).toEqual([expect.stringContaining('triage failed 3 times')])
    await poll()
    await drain()
    expect(await gaveUp(t.n)).toHaveLength(1)
    expect(await runs(t.id, 'triage')).toHaveLength(3)
  })
}

it('a triage Run that throws counts as an attempt and is retried up to the ceiling', async () => {
  exec.mockImplementation(async () => { throw new Error('no gateway key') })
  const t = await create('thrown')
  for (let i = 0; i < 3; i++) {
    expect(await runs(t.id, 'triage')).toHaveLength(i + 1)
    await expect(runLatest(t.id, 'triage')).rejects.toThrow('no gateway key')
    await drain()
  }
  expect(await runs(t.id, 'triage')).toHaveLength(3)
  expect(await gaveUp(t.n)).toHaveLength(1)
})

it('a non-triage Run still posts its Comment', async () => {
  const t = await create('planned', ['bauherr:stage:plan'])
  exec.mockResolvedValue({ status: 'budget_exhausted', artifacts: {}, usage })
  await runLatest(t.id, 'plan')
  expect(await comments(t.n)).toEqual(['Bauherr stopped: the Workspace budget is exhausted'])
  const u = await create('planned2', ['bauherr:stage:plan'])
  exec.mockResolvedValue({ status: 'needs_human', reason: 'unmet Goal', artifacts: {}, usage })
  await runLatest(u.id, 'plan')
  expect(await comments(u.n)).toEqual(['Bauherr needs a human: unmet Goal'])
})

it('a Run ended while the Runner works (sendBack) keeps its status and its result is dropped', async () => {
  const t = await create('sent back', ['bauherr:stage:plan'])
  const run = (await runs(t.id, 'plan')).at(-1)!
  exec.mockImplementation(async () => {
    await payload.update({ collection: 'runs', id: run.id, data: { status: 'cancelled' }, ...o })
    return { status: 'needs_human', reason: 'unmet Goal', artifacts: {}, usage }
  })
  await runLatest(t.id, 'plan')
  expect((await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })).status).toBe('cancelled')
  expect(await comments(t.n)).toEqual([])
})

/** Runs the latest triage Run while observing the Run's status each time the Ticket is untriaged; `fail` makes the untriage throw. */
const untriageObserved = async (ticket: number, fail = false) => {
  const orig = payload.update.bind(payload) as (a: any) => Promise<unknown>
  const statuses: string[] = []
  const update = vi.spyOn(payload, 'update').mockImplementation((async (a: any) => {
    if (a.collection === 'tickets' && a.data?.triagedAt === null) {
      statuses.push(((await runs(ticket, 'triage')).at(-1) as Record<string, any>).status)
      if (fail) throw new Error('untriage down')
    }
    return orig(a)
  }) as any)
  const queue = vi.spyOn(payload.jobs, 'queue')
  try {
    await runLatest(ticket, 'triage')
  } catch (e) {
    return { statuses, error: e as Error, reconciled: queue.mock.calls.some(([q]) => (q as any).task === 'reconcile-costs') }
  } finally {
    update.mockRestore()
    queue.mockRestore()
  }
  return { statuses, error: null, reconciled: true }
}

it('untriages only after the triage Run is terminal', async () => {
  const t = await create('untriage order')
  exec.mockResolvedValue({ status: 'needs_human', reason: 'stopped', artifacts: {}, usage })
  expect((await untriageObserved(t.id)).statuses).toEqual(['needs_human'])
  const u = await create('untriage order failed')
  exec.mockImplementation(async () => { throw new Error('boom') })
  const r = await untriageObserved(u.id)
  expect(r.statuses).toEqual(['failed'])
  expect(r.error?.message).toBe('boom')
})

it('a failing untriage is logged, keeps the original error and still queues the reconcile', async () => {
  const t = await create('untriage down')
  exec.mockImplementation(async () => { throw new Error('boom') })
  const r = await untriageObserved(t.id, true)
  expect(r.error?.message).toBe('boom')
  expect(r.reconciled).toBe(true)
})
