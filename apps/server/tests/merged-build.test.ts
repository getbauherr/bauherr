import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('merged_build')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', wipLimits: {}, defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, checkRetries: 0 }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input) => callTool({ payload, user: member, actor: { kind: 'human' } }, name, input)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.update({ collection: 'runs', where: { and: [{ workspace: { equals: ws } }, { status: { in: ['awaiting_session', 'running'] } }] }, data: { status: 'cancelled' }, ...o })
})

/** A Build Ticket with an awaiting Build Run and an open MR from `branch` (default: the Ticket's factory branch). */
const seed = async (opts: { branch?: string; rank?: string; mergeSha?: string } = {}) => {
  const issue = await fake.tickets(repo).create({ title: `t${++n}`, labels: ['bauherr:stage:build'] })
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', labels: [], stage: 'build', product, workspace: ws, rank: opts.rank ?? 'a', needsYou: 'Run needs you', ...(opts.mergeSha && { mergeSha: opts.mergeSha }) }, ...o })
  const head = opts.branch ?? `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, head)
  fake.commit(repo, head, 'src/a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 't', body: '## Evidence\nx\n\n## Blast radius\nSure: `read the code`', head, base: 'main' })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  return { id: ticket.id as number, runId: run.id as number, pr }
}
const claim = async (runId: number) => ({ runId, leaseToken: (await call('claim_run', { runId })).leaseToken })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runOf = async (id: number) => (await payload.findByID({ collection: 'runs', id, depth: 0, ...o })) as Record<string, any>

it('finish_run on the Ticket\'s merged factory MR ends the Run succeeded and moves the Ticket to release', async () => {
  const { id, runId, pr } = await seed()
  const a = await claim(runId)
  const sha = fake.merge(repo, pr.number)
  expect(await call('finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).toMatchObject({ status: 'succeeded' })
  expect(await runOf(runId)).toMatchObject({ status: 'succeeded' })
  expect(await reload(id)).toMatchObject({ stage: 'release', mergeSha: sha, releaseState: 'waiting', needsYou: null })
})

it('finish_run refuses a merged MR that is not a factory MR of the Ticket', async () => {
  const { id, runId, pr } = await seed({ branch: 'feat-foreign' })
  const a = await claim(runId)
  fake.merge(repo, pr.number)
  await expect(call('finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).rejects.toThrow(/prUrl must be an open pull request/)
  expect((await runOf(runId)).status).toBe('running')
  expect((await reload(id)).stage).toBe('build')
})

it('finish_run refuses the merge a sent-back Ticket was already released with', async () => {
  const { id, runId, pr } = await seed()
  const a = await claim(runId)
  const sha = fake.merge(repo, pr.number)
  await payload.update({ collection: 'tickets', id, data: { mergeSha: sha }, ...o })
  await expect(call('finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).rejects.toThrow(/prUrl must be an open pull request/)
  expect((await reload(id)).stage).toBe('build')
})

it('relink_mr keeps refusing a merged MR', async () => {
  const { runId, pr } = await seed()
  const a = await claim(runId)
  fake.merge(repo, pr.number)
  await expect(call('relink_mr', { ...a, prUrl: pr.url })).rejects.toThrow(/prUrl must be an open pull request/)
})

it('claim_next cancels a Build Run whose MR merged, releases the Ticket and hands out the next Run', async () => {
  const merged = await seed({ rank: 'a' })
  const next = await seed({ rank: 'b' })
  const sha = fake.merge(repo, merged.pr.number)
  const claimed = await call('claim_next', { product: 'web' })
  expect(claimed.run.id).toBe(next.runId)
  expect(await runOf(merged.runId)).toMatchObject({ status: 'cancelled', error: 'the MR merged during Build' })
  expect(await reload(merged.id)).toMatchObject({ stage: 'release', mergeSha: sha, needsYou: null })
})

it('claim_run on a Build Run whose MR merged is a skip and releases the Ticket', async () => {
  const { id, runId, pr } = await seed()
  const sha = fake.merge(repo, pr.number)
  await expect(call('claim_run', { runId })).rejects.toThrow(/merged during Build/)
  expect(await reload(id)).toMatchObject({ stage: 'release', mergeSha: sha })
  expect((await runOf(runId)).status).toBe('cancelled')
})

it('claim_run does not hand out a Build Run of a Ticket the watcher already released', async () => {
  const { id, runId, pr } = await seed()
  const sha = fake.merge(repo, pr.number)
  await payload.update({ collection: 'tickets', id, data: { stage: 'release', mergeSha: sha, releaseState: 'waiting' }, ...o })
  await expect(call('claim_run', { runId })).rejects.toThrow(/merged during Build/)
  expect((await runOf(runId)).status).toBe('awaiting_session')
})

it('a forge failure in the claim path still hands out the Run', async () => {
  const { runId } = await seed()
  const spy = vi.spyOn(fake.forge, 'getPullRequest').mockRejectedValueOnce(new Error('forge down'))
  expect(await call('claim_run', { runId })).toMatchObject({ run: { id: runId } })
  spy.mockRestore()
})

it('finish_run after the watcher released the Ticket ends the Run succeeded', async () => {
  const { id, runId, pr } = await seed()
  const a = await claim(runId)
  const sha = fake.merge(repo, pr.number)
  await payload.update({ collection: 'tickets', id, data: { stage: 'release', mergeSha: sha, releaseState: 'waiting' }, ...o })
  expect(await call('finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).toMatchObject({ status: 'succeeded' })
  expect(await runOf(runId)).toMatchObject({ status: 'succeeded' })
  expect(await reload(id)).toMatchObject({ stage: 'release', mergeSha: sha })
})
