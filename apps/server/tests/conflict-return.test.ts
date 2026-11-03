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
let ws: number
let product: number
beforeAll(async () => {
  testDb = await createTestDb('conflict_return')
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
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** Runs a Build Run on a Ticket with an open MR and returns its conflictReturns. */
const buildResult = async (artifacts: Record<string, unknown>) => {
  const issue = await fake.tickets(repo).create({ title: 'build', labels: ['bauherr:stage:build'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'build', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 'build', body: '## Evidence\nok', head: branch, base: 'main' })
  const run = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'queued', mode: 'autonomous', workspace: ws }, ...o })
  exec.mockResolvedValue({ status: 'succeeded', artifacts: { prUrl: pr.url, ...artifacts }, usage })
  await (jobs.runStage.handler as (a: unknown) => Promise<unknown>)({ input: { runId: run.id }, req: { payload } })
  return ((await payload.findByID({ collection: 'tickets', id: t.id, depth: 0, ...o })) as Record<string, any>).conflictReturns
}

it('a Build Run that resolved conflict markers counts one conflict return; a clean main-merge Run does not', async () => {
  expect(await buildResult({ mergeConflict: true })).toBe(1)
  expect(await buildResult({ patchId: 'p', pushedSha: 'x' })).toBe(0)
})
