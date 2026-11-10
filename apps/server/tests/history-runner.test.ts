import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const exec = vi.hoisted(() => vi.fn())
vi.mock('@bauherr/runner', async (orig) => ({ ...(await orig<typeof import('@bauherr/runner')>()), runStage: exec }))

let payload: Payload
let fake: FakeBackend
let jobs: typeof import('../src/jobs')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 }

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('history_runner')
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

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('an autonomous Run stores the executor, the model it used and its provider, and closes its Steps', async () => {
  const issue = await fake.tickets(repo).create({ title: 'autonomous' })
  await (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
  const ticket = (await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>
  const run = (await payload.find({ collection: 'runs', where: { ticket: { equals: ticket.id } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>
  const step = (model: string, messageId: string) => ({ runId: String(run.id), messageId, model, inputTokens: 1, outputTokens: 1, cacheRead: 0, cacheWrite: 0 })
  exec.mockImplementation(async (ctx: any) => {
    await ctx.recorder.step(step('claude-haiku-4-5', 'm1'))
    await ctx.recorder.step(step('', 'm2'))
    return { status: 'budget_exhausted', artifacts: {}, usage }
  })
  await (jobs.runStage.handler as (a: unknown) => Promise<unknown>)({ input: { runId: run.id }, req: { payload } })

  expect(await payload.findByID({ collection: 'runs', id: run.id, depth: 0, ...o })).toMatchObject({ executor: 'runner', model: 'claude-haiku-4-5', provider: 'bedrock' })
  const steps = (await payload.find({ collection: 'steps', where: { run: { equals: run.id } }, sort: 'seq', depth: 0, ...o })).docs as Record<string, any>[]
  expect(steps).toHaveLength(2)
  expect(steps.every((s) => s.finishedAt)).toBe(true)
  const events = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticket.id } }, sort: ['at', 'id'], depth: 0, ...o })).docs as Record<string, any>[]
  expect(events.map((e) => [e.stage, e.phase, e.executor, e.cause])).toEqual(expect.arrayContaining([['triage', 'working', 'runner', 'run:started']]))
})
