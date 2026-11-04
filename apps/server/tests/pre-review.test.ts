import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { reviewRoundStats } from '../scripts/review-rounds'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const RULES = { tests: [{ src: ['src/**'], tests: ['tests/**'] }] }

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('pre_review')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  for (const pr of await fake.forge.listPullRequests(repo, 'open')) await fake.forge.closePullRequest(repo, pr.number)
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: RULES }, ...o })
})

/** A claimed session build Run on Ticket #1 and an open factory MR holding `files`. */
const seed = async (files: Record<string, string>) => {
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: `p-${++n}`, number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  const head = `bauherr/1-${n}`
  await fake.forge.createBranch(repo, head)
  for (const [path, content] of Object.entries(files)) fake.commit(repo, head, path, content)
  const pr = await fake.forge.openPullRequest(repo, { title: 't', body: 'b', head, base: 'main' })
  return { ticket, run, a: { runId: run.id, leaseToken }, pr }
}
const stage = async (id: number) => ((await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>).stage
const STEPS = '| Plan step | done/deferred | Evidence or reason |\n|---|---|---|\n| 1 | done | x |\n| 2 | deferred | later |'

it('request_review is refused while a rule fails, leaves the Ticket in build, and passes once satisfied', async () => {
  const { ticket, a, pr } = await seed({ 'src/a.ts': 'x' })
  await expect(call(member, 'request_review', a)).rejects.toThrow('Pre-review checks failed:\n- src/a.ts changed but no file matching tests/** did')
  expect(await stage(ticket.id as number)).toBe('build')
  const failures = (await call(member, 'run_checks', a)).failures
  expect(failures).toHaveLength(1)
  await fake.forge.closePullRequest(repo, pr.number)
  const fixed = await seed({ 'src/a.ts': 'x', 'tests/a.test.ts': 'y' })
  expect((await call(member, 'run_checks', fixed.a)).failures).toEqual([])
  await expect(call(member, 'request_review', fixed.a)).resolves.toMatchObject({ stage: 'review' })
  expect(await stage(fixed.ticket.id as number)).toBe('review')
})

it('request_review passes with the rules off', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: null }, ...o })
  const { a } = await seed({ 'src/a.ts': 'x' })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
})

it('finish_run with an MR enforces the same checks and keeps the Run running', async () => {
  const { ticket, run, a, pr } = await seed({ 'src/a.ts': 'x' })
  await expect(call(member, 'finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).rejects.toThrow('Pre-review checks failed')
  expect(await stage(ticket.id as number)).toBe('build')
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('running')
})

it('the evidence rule needs a done/deferred row per plan step and the named test files must exist', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: { ...RULES, evidence: true } }, ...o })
  const { a } = await seed({ 'src/a.ts': 'x', 'tests/a.test.ts': 'y' })
  await expect(call(member, 'request_review', a)).rejects.toThrow('no done/deferred row for plan step 1')
  await call(member, 'attach_evidence', { ...a, markdown: `${STEPS}\nran tests/missing.test.ts` })
  await expect(call(member, 'request_review', a)).rejects.toThrow('tests/missing.test.ts, which does not exist')
  await call(member, 'attach_evidence', { ...a, markdown: 'ran tests/a.test.ts' })
  await payload.update({ collection: 'runs', id: a.runId, data: { evidence: `${STEPS}\nran tests/a.test.ts` }, ...o })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
})

it('review-rounds splits merged Tickets at the cutoff', () => {
  const rows = [
    { reviewRounds: 2, releaseAt: '2026-10-30T00:00:00Z' },
    { reviewRounds: 1, releaseAt: '2026-10-31T00:00:00Z' },
    { reviewRounds: 0, releaseAt: '2026-10-31T00:00:00Z' },
    { reviewRounds: 4, releaseAt: '2026-11-06T00:00:00Z' },
    { reviewRounds: 9, releaseAt: null },
  ]
  expect(reviewRoundStats(rows, '2026-11-05')).toEqual({
    before: { tickets: 3, rounds: 3, mean: 1, median: 1 },
    after: { tickets: 1, rounds: 4, mean: 4, median: 4 },
  })
  expect(reviewRoundStats([], '2026-11-05').before).toEqual({ tickets: 0, rounds: 0, mean: null, median: null })
})
