import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const exec = vi.hoisted(() => vi.fn())
vi.mock('@bauherr/runner', async (orig) => ({ ...(await orig<typeof import('@bauherr/runner')>()), runStage: exec }))

let payload: Payload
let fake: import('@bauherr/adapters').FakeBackend
let jobs: typeof import('../src/jobs')
let testDb: TestDb
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  testDb = await createTestDb('run_claim')
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
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

beforeEach(async () => {
  exec.mockReset()
  exec.mockImplementation(async () => (await sleep(300), { status: 'succeeded', artifacts: {}, usage }))
  await payload.delete({ collection: 'payload-jobs' as never, where: {}, ...o })
  await payload.update({ collection: 'runs', where: { status: { equals: 'queued' } }, data: { status: 'failed' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** Creates a Ticket in the plan stage with one queued autonomous Run and its `run-stage` job. */
const queuedRun = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:plan'] })
  await (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
  const t = (await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0]
  return (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { status: { equals: 'queued' } }] }, depth: 0, ...o })).docs[0]
}
const runOne = () => payload.jobs.run({ queue: 'runs', limit: 1 })
/** Run ids handed to the executor. A poll may also start Runs for Tickets of earlier tests, so the tests assert that no Run executed twice, not a total. */
const executed = () => exec.mock.calls.map(([ctx]) => ctx.run.id as string)
const unique = (ids: string[]) => new Set(ids).size === ids.length
const handle = (runId: number | string) => (jobs.runStage.handler as (a: unknown) => Promise<unknown>)({ input: { runId }, req: { payload } })

it('parallel workers execute each Run once', async () => {
  await queuedRun('a')
  await queuedRun('b')
  await Promise.all([runOne(), runOne(), runOne()])
  expect(executed().length).toBeGreaterThanOrEqual(2)
  expect(unique(executed())).toBe(true)
})

it('a second job for a Run that is already executing does nothing', async () => {
  const run = await queuedRun('c')
  await payload.jobs.queue({ task: 'run-stage', queue: 'runs', input: { runId: run.id } })
  await Promise.all([runOne(), runOne()])
  expect(executed().length).toBeGreaterThanOrEqual(1)
  expect(unique(executed())).toBe(true)
})

it('two workers handling the same queued Run: one executes it', async () => {
  const run = await queuedRun('d')
  await Promise.all([handle(run.id), handle(run.id)])
  expect(executed().filter((id) => id === String(run.id))).toHaveLength(1)
})
