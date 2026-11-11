import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const exec = vi.hoisted(() => vi.fn())
vi.mock('@bauherr/runner', async (orig) => ({ ...(await orig<typeof import('@bauherr/runner')>()), runStage: exec }))

/** An autonomous `agent` Run (fixtures/custom-pack, stage security): the Runner reports the outcome file, the job routes the Ticket. */
let payload: Payload
let fake: FakeBackend
let jobs: typeof import('../src/jobs')
let ws: number
let product: number
const o = { overrideAccess: true } as const
const repo = 'acme/auto'
const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 }

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/custom-pack', import.meta.url))
  testDb = await createTestDb('agent_stage_auto')
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
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const securityRun = async () => {
  const issue = await fake.tickets(repo).create({ title: 't', labels: ['bauherr:stage:security'] })
  const t = (await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'security', product, workspace: ws }, ...o })).id as number
  const { startRunIfNeeded } = jobs
  const { run } = await startRunIfNeeded(payload, { id: t, workspace: ws }, 'security')
  return { t, issue, run: run.id as number }
}
const runJob = (runId: number) => (jobs.runStage.handler as (a: unknown) => Promise<unknown>)({ input: { runId }, req: { payload } })
const get = async (collection: 'runs' | 'tickets', id: number) => (await payload.findByID({ collection, id, depth: 0, ...o })) as Record<string, any>

it('a reported outcome is validated, commented and routes the Ticket; the Run carries the agent brief', async () => {
  const { t, issue, run } = await securityRun()
  exec.mockImplementationOnce(async (ctx: any) => {
    expect(ctx.run).toMatchObject({ kind: 'agent', tier: 'standard' })
    expect(ctx.agent).toMatchObject({ stage: 'security', skill: 'security-review', outcomes: ['pass', 'findings', 'unclear'], roleProfile: expect.stringContaining('security problems') })
    return { status: 'succeeded', artifacts: { agentOutcome: { outcome: 'findings', comment: 'XSS in b.ts' } }, usage }
  })
  await runJob(run)
  expect(await get('runs', run)).toMatchObject({ status: 'succeeded', outcome: 'findings' })
  expect(await get('tickets', t)).toMatchObject({ stage: 'build' })
  expect((await fake.tickets(repo).listComments(String(issue.number))).some((c) => c.body === '<!-- bauherr:stage:security -->\nXSS in b.ts')).toBe(true)
})

it.each([
  ['no outcome file', {}, /no outcome reported/],
  ['an outcome the stage does not have', { agentOutcome: { outcome: 'maybe' } }, /outcome must be one of pass, findings, unclear/],
])('%s fails the Run and leaves the Ticket in its stage', async (_n, artifacts, message) => {
  const { t, run } = await securityRun()
  exec.mockImplementationOnce(async () => ({ status: 'succeeded', artifacts, usage }))
  await runJob(run)
  const r = await get('runs', run)
  expect(r.status).toBe('failed')
  expect(r.error).toMatch(message)
  expect(await get('tickets', t)).toMatchObject({ stage: 'security' })
})

it('an autonomous Build Run that reports replan sends the Ticket back to Plan with the comment, without an MR', async () => {
  const issue = await fake.tickets(repo).create({ title: 'b', labels: ['bauherr:stage:build', 'bauherr:approved:plan'] })
  const t = (await payload.create({ collection: 'tickets', data: { title: 'b', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', labels: ['bauherr:stage:build', 'bauherr:approved:plan'], product, workspace: ws }, ...o })).id as number
  const { run } = await jobs.startRunIfNeeded(payload, { id: t, workspace: ws }, 'build')
  exec.mockImplementationOnce(async () => ({ status: 'succeeded', artifacts: { agentOutcome: { outcome: 'replan', comment: 'step 2 is impossible' } }, usage }))
  await runJob(run.id as number)
  expect(await get('runs', run.id as number)).toMatchObject({ status: 'succeeded', outcome: 'replan' })
  expect(await get('tickets', t)).toMatchObject({ stage: 'plan' })
  expect((await fake.tickets(repo).get(String(issue.number))).labels).not.toContain('bauherr:approved:plan')
  expect(((await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t } }, { stage: { equals: 'plan' } }] }, depth: 0, ...o })).docs as Record<string, any>[]).map((r) => r.status)).toEqual([expect.stringMatching(/queued|awaiting_session|running/)])
  expect((await fake.tickets(repo).listComments(String(issue.number))).some((c) => c.body === '<!-- bauherr:stage:build -->\nstep 2 is impossible')).toBe(true)
})
