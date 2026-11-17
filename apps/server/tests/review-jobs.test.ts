import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let member: Doc
let call: (name: string, input?: unknown) => Promise<any>
let advance: typeof import('../src/lib/advance').advance
let finishAgentRun: typeof import('../src/lib/agent-stage').finishAgentRun
let actions: typeof import('../src/lib/actions')
let stageJobs: typeof import('../src/lib/stage-jobs')
let jobs: typeof import('../src/jobs')
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
const repo = 'acme/review-jobs'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const pending = [{ name: 'ci', status: 'in_progress', conclusion: null }]
const EVIDENCE = 'Closes it\n\n## Evidence\n| Goal | verified |\n\n## Blast radius\nSafe because x. Sure: `read the code`\n'
const checked = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'].map((area) => ({ area, note: `checked ${area}` }))
const finding = { severity: 'medium', class: 'security', file: 'a.ts', line: 3, msg: 'off by one', scenario: 'when n is 0, then it returns -1' }

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/review-jobs-pack', import.meta.url))
  testDb = await createTestDb('review_jobs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ;({ advance } = await import('../src/lib/advance'))
  ;({ finishAgentRun } = await import('../src/lib/agent-stage'))
  actions = await import('../src/lib/actions')
  stageJobs = await import('../src/lib/stage-jobs')
  jobs = await import('../src/jobs')
  release = await import('../src/lib/release')
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, pathSets: { ui: ['src/app/**'], security: ['src/auth/**'] } }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input = {}) => callTool({ payload, user: member, actor: { kind: 'human' } }, name, input)
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'cancelled' WHERE "status" IN ('awaiting_session', 'running', 'queued')`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "state" = 'closed' WHERE "state" = 'open'`)
})

const get = async (collection: 'runs' | 'tickets', id: number) => (await payload.findByID({ collection, id, depth: 0, ...o })) as Doc
const runsOf = async (ticket: number) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket } }, { stage: { equals: 'review' } }] }, sort: 'id', depth: 0, pagination: false, ...o })).docs as Doc[]
const byJob = async (ticket: number, job: string | null) => (await runsOf(ticket)).filter((r) => (r.job ?? null) === job)
const statuses = async (ticket: number) => Object.fromEntries((await runsOf(ticket)).map((r) => [r.job ?? 'review', r.status]))
const events = async (ticket: number) => (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticket } }, sort: ['at', 'id'], depth: 0, pagination: false, ...o })).docs as Doc[]
const prOf = async (id: number) => (await release.prOf(payload, await get('tickets', id)))!

const reviewing = async (title: string, files: string[], opts: { labels?: string[]; checks?: any[] } = {}) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:build'] })
  const id = (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws, labels: opts.labels ?? [] }, ...o })).id as number
  const branch = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(repo, branch)
  for (const f of files) fake.commit(repo, branch, f, `x${Math.random()}`)
  const pr = await fake.forge.openPullRequest(repo, { title, body: EVIDENCE, head: branch, base: 'main' })
  fake.setChecks(repo, pr.headSha, opts.checks ?? green)
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', kind: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  await advance(payload, null, await get('tickets', id), 'done', { by: 'factory' })
  return { id, pr, branch, number: issue.number as number }
}
const finish = async (ticket: number, job: string, extra: Doc = {}) => {
  const run = (await byJob(ticket, job)).at(-1)!
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'succeeded', ...extra }, ...o })
  await finishAgentRun(payload, await get('runs', run.id), await get('tickets', ticket), 'done')
  return run.id as number
}
const claim = async (role: string) => (await call('claim_next', { roles: [role] }))
const submit = (c: { run: Doc; leaseToken: string }, findings: any[] = [], extra: Doc = {}) =>
  call('submit_review', { runId: c.run.id, leaseToken: c.leaseToken, verdict: findings.some((f) => f.severity !== 'low') ? 'changes' : 'clean', findings, checked, markdown: '**Verdict**: x', ...extra })
const rebuilt = async (ticket: number, pr: Doc, branch: string) => {
  fake.commit(repo, branch, `fix${Math.random()}.ts`, 'y')
  fake.setChecks(repo, (await fake.forge.getPullRequest(repo, pr.number)).headSha, green)
  await payload.create({ collection: 'runs', data: { ticket, stage: 'build', kind: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  await advance(payload, null, await get('tickets', ticket), 'done', { by: 'factory' })
}
it('entering review starts the finds in parallel; a find whose when does not match is skipped and recorded; verify waits for all finds', async () => {
  const { id } = await reviewing('ui', ['src/app/page.tsx'])
  expect(await get('tickets', id)).toMatchObject({ stage: 'review', reviewState: null })
  expect((await runsOf(id)).map((r) => [r.job, r.kind, r.role, r.status])).toEqual([['ux', 'agent', 'ux', 'awaiting_session']])
  expect((await events(id)).filter((e) => e.cause === 'skip:review').map((e) => e.job).sort()).toEqual(['security', 'test'])
  await finish(id, 'ux')
  expect(await statuses(id)).toEqual({ ux: 'succeeded', verify: 'awaiting_session' })
  expect(await byJob(id, null)).toHaveLength(0)
})

it('a bug touching security and ui starts all three finds at once', async () => {
  const { id } = await reviewing('all', ['src/app/page.tsx', 'src/auth/login.ts'], { labels: ['bauherr:type:bug'] })
  expect(Object.keys(await statuses(id)).sort()).toEqual(['security', 'test', 'ux'])
  expect((await events(id)).filter((e) => e.cause === 'skip:review')).toHaveLength(0)
})

it('verify and the review Run read the candidates of the Jobs they need; the review Run stays kind review and concludes as before', async () => {
  const { id } = await reviewing('rank', ['src/app/page.tsx'])
  const found = { ...finding, class: 'rule' }
  await finish(id, 'ux', { findings: [found], artifacts: { open: [{ text: 'maybe', reason: 'no-evidence' }] } })
  const verify = await claim('reviewer')
  expect(verify).toMatchObject({ run: { job: 'verify' }, agent: { job: 'verify', outcomes: ['done'] }, candidates: [{ job: 'ux', findings: [found], open: [{ text: 'maybe', reason: 'no-evidence' }] }], ticket: { reviewRound: 1 } })
  const verified = { ...finding, class: 'rule', msg: 'verified' }
  await call('finish_run', { runId: verify.run.id, leaseToken: verify.leaseToken, status: 'succeeded', outcome: 'done', findings: [verified], open: [] })
  expect(await get('runs', verify.run.id)).toMatchObject({ status: 'succeeded', outcome: 'done', findings: [verified], artifacts: { open: [] } })
  expect(await get('tickets', id)).toMatchObject({ stage: 'review', reviewState: null })

  const own = await claim('reviewer')
  expect(own.run).toMatchObject({ kind: 'review', job: null })
  expect(own.candidates).toEqual([{ job: 'verify', findings: [verified], open: [] }])
  await expect(call('finish_run', { runId: own.run.id, leaseToken: own.leaseToken, status: 'succeeded', findings: [] })).rejects.toThrow('only for the Jobs of a review stage')
  expect(await submit(own)).toMatchObject({ verdict: 'clean', outcome: 'merged' })
  expect(await get('tickets', id)).toMatchObject({ reviewState: 'merged' })
})

it('verdict changes sends the Ticket to Build, counts a round and cancels the live find Runs; the next visit starts all Jobs with round 2 and the fix base', async () => {
  const { id, pr, branch } = await reviewing('changes', ['src/app/page.tsx', 'src/auth/login.ts'], { labels: ['bauherr:type:bug'] })
  const head = pr.headSha
  const own = await jobs.startRunIfNeeded(payload, (await get('tickets', id)) as { id: number }, 'review')
  const claimed = await claim('reviewer')
  expect(claimed.run.id).toBe(own.run.id)
  expect(await submit(claimed, [finding])).toMatchObject({ verdict: 'changes', outcome: 'build' })
  expect(await get('tickets', id)).toMatchObject({ stage: 'build', reviewRounds: 1 })
  expect(await statuses(id)).toEqual({ security: 'cancelled', ux: 'cancelled', test: 'cancelled', review: 'succeeded' })

  await rebuilt(id, pr, branch)
  expect(await get('tickets', id)).toMatchObject({ stage: 'review' })
  expect((await runsOf(id)).filter((r) => r.status === 'awaiting_session')).toHaveLength(3)
  const next = await claim('ux')
  expect(next).toMatchObject({ run: { job: 'ux' }, ticket: { reviewRound: 2, fixReviewBase: head } })
})

it('a clean verdict waits for pending checks as before', async () => {
  const { id } = await reviewing('waits', ['src/app/page.tsx'])
  await finish(id, 'ux')
  await finish(id, 'verify')
  const own = await claim('reviewer')
  fake.setChecks(repo, (await prOf(id)).pr.headSha, pending)
  expect(await submit(own)).toMatchObject({ verdict: 'clean', outcome: 'waiting_checks' })
  expect(await get('tickets', id)).toMatchObject({ stage: 'review', reviewState: 'waiting_checks' })
})

it('a head that moved while waiting for checks starts a new visit: every Job runs again', async () => {
  const { id, branch } = await reviewing('moved', ['src/app/page.tsx'])
  await finish(id, 'ux')
  await finish(id, 'verify')
  const own = await claim('reviewer')
  fake.setChecks(repo, (await prOf(id)).pr.headSha, pending)
  expect(await submit(own)).toMatchObject({ outcome: 'waiting_checks' })
  fake.commit(repo, branch, 'more.ts', 'z')
  fake.setChecks(repo, (await prOf(id)).pr.headSha, green)
  await actions.watchReviews(payload)
  expect(await get('tickets', id)).toMatchObject({ stage: 'review', reviewState: null })
  expect((await byJob(id, 'ux')).map((r) => r.status)).toEqual(['succeeded', 'awaiting_session'])
  expect(await byJob(id, 'verify')).toHaveLength(1)
  expect(await byJob(id, null)).toHaveLength(1)
  await finish(id, 'ux')
  expect((await byJob(id, 'verify')).map((r) => r.status)).toEqual(['succeeded', 'awaiting_session'])
})

it('invalid review output reruns only the review Run on strong, with the same candidates', async () => {
  const { id } = await reviewing('invalid', ['src/app/page.tsx'])
  await finish(id, 'ux')
  const kept = [{ ...finding, class: 'rule' }]
  await finish(id, 'verify', { findings: kept })
  const own = await claim('reviewer')
  expect(await submit(own, [], { checked: [] })).toMatchObject({ outcome: 'ready_for_human' })
  const before = (await runsOf(id)).length
  const { escalateInvalidReview } = await import('../src/lib/escalation')
  expect(await escalateInvalidReview(payload, await get('tickets', id), await get('runs', own.run.id))).toBeTruthy()
  const after = await runsOf(id)
  expect(after).toHaveLength(before + 1)
  expect(after.at(-1)).toMatchObject({ job: null, kind: 'review', status: 'awaiting_session', escalation: { step: 2 } })
  const again = await claim('reviewer')
  expect(again.candidates).toEqual([{ job: 'verify', findings: kept, open: [] }])
})

it('a conflict return sends the Ticket to Build; re-entry runs all Jobs again and the find claim carries the conflict base', async () => {
  const { id, pr, branch } = await reviewing('conflict', ['src/app/page.tsx'])
  await finish(id, 'ux')
  await finish(id, 'verify')
  const own = await claim('reviewer')
  await payload.update({ collection: 'runs', id: own.run.id, data: { status: 'succeeded', verdict: 'clean', reviewedSha: pr.headSha }, ...o })
  expect(await actions.returnConflictToBuild(payload, await get('tickets', id), await prOf(id), pr.headSha)).toBe('build')
  await payload.update({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, data: { status: 'cancelled' }, ...o })
  await rebuilt(id, pr, branch)
  const next = await claim('ux')
  expect(next).toMatchObject({ run: { job: 'ux' }, ticket: { conflictReturnBase: (await get('tickets', id)).conflictReturnBase } })
  expect((await get('tickets', id)).conflictReturnBase).toBeTruthy()
  expect(await byJob(id, 'ux')).toHaveLength(2)
})

it('a re-bound verdict (same patch on a new head) starts no Jobs', async () => {
  const { id, pr, branch } = await reviewing('rebind', ['src/app/page.tsx'])
  await finish(id, 'ux')
  await finish(id, 'verify')
  const own = await claim('reviewer')
  fake.setChecks(repo, pr.headSha, pending)
  await payload.update({ collection: 'runs', id: own.run.id, data: { reviewedPatchId: 'patch-x' }, ...o })
  expect(await submit(own)).toMatchObject({ outcome: 'waiting_checks' })
  fake.commit(repo, branch, 'main.ts', 'merged main')
  const head = (await fake.forge.getPullRequest(repo, pr.number)).headSha
  fake.setChecks(repo, head, pending)
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', kind: 'build', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { patchId: 'patch-x', pushedSha: head } }, ...o })
  await payload.update({ collection: 'tickets', id, data: { reviewState: null }, ...o })
  const before = (await runsOf(id)).length
  expect(await actions.rebindReview(payload, await get('tickets', id))).toBe(true)
  expect((await runsOf(id)).length).toBe(before)
  expect(await get('tickets', id)).toMatchObject({ stage: 'review', reviewState: 'waiting_checks' })
})

it('the review Run starts once per visit, also after a crash between the last Job and the Run', async () => {
  const { id } = await reviewing('crash', ['src/app/page.tsx'])
  await finish(id, 'ux')
  await finish(id, 'verify')
  expect(await byJob(id, null)).toHaveLength(1)
  await Promise.all([stageJobs.startReadyJobs(payload, { id }), stageJobs.startReadyJobs(payload, { id })])
  expect(await byJob(id, null)).toHaveLength(1)
  const own = (await byJob(id, null))[0]!
  await payload.update({ collection: 'runs', id: own.id, data: { status: 'cancelled' }, ...o })
  await stageJobs.startReadyJobs(payload, { id })
  expect(await byJob(id, null)).toHaveLength(1)
  const jobRuns = (await runsOf(id)).filter((r) => r.job).length
  expect(await jobs.startReviewIfReady(payload, await get('tickets', id))).toBeTruthy()
  expect(await byJob(id, null)).toHaveLength(2)
  expect((await runsOf(id)).filter((r) => r.job)).toHaveLength(jobRuns)
})

it('a failed find Run is a dead Ticket the ladder climbs', async () => {
  const { id } = await reviewing('dead', ['src/app/page.tsx'])
  const run = (await byJob(id, 'ux'))[0]!
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'failed', error: 'boom' }, ...o })
  const { deadTickets } = await import('../src/lib/liveness')
  expect((await deadTickets(payload, ws)).filter((d) => d.ticket.id === id).map((d) => d.cause)).toEqual(['run-failed'])
})

it('finish_run refuses candidates from a review Job whose findings are malformed', async () => {
  await reviewing('bad', ['src/app/page.tsx'])
  const c = await claim('ux')
  await expect(call('finish_run', { runId: c.run.id, leaseToken: c.leaseToken, status: 'succeeded', outcome: 'done', findings: [{ ...finding, line: -1 }] })).rejects.toThrow('finding 0')
  expect((await get('runs', c.run.id)).status).toBe('running')
})

it('a session that built the MR cannot claim any Run of the review stage: find, verify or review', async () => {
  const { id } = await reviewing('own', ['src/app/page.tsx'])
  await payload.update({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }] }, data: { sessionLabel: 'dev-1' }, ...o })
  expect(await call('claim_next', { roles: ['ux'], session: 'dev-1' })).toBeNull()
  const ux = (await byJob(id, 'ux'))[0]!
  await expect(call('claim_run', { runId: ux.id, session: 'dev-1' })).rejects.toThrow('your own build')
  expect((await call('list_frontier', { session: 'dev-1' })).find((t: Doc) => t.ticket === id)).toMatchObject({ claimable: false, reason: 'your own build' })
  expect((await call('claim_next', { roles: ['ux'], session: 'other' })).run).toMatchObject({ job: 'ux' })
})

it('candidates are served without test patches and capped at 50 KB per Job with a truncated note', async () => {
  const { id } = await reviewing('big', ['src/app/page.tsx'])
  const big = Array.from({ length: 50 }, (_, i) => ({ ...finding, class: 'correctness', line: i, msg: 'm'.repeat(1000), scenario: 's'.repeat(1000), test: { command: 'c', failure: 'f', patch: 'p'.repeat(4000) } }))
  await finish(id, 'ux', { findings: big })
  const verify = await claim('reviewer')
  const [served] = verify.candidates
  expect(served).toMatchObject({ job: 'ux', truncated: true })
  expect(served.findings.length).toBeGreaterThan(0)
  expect(served.findings.length).toBeLessThan(50)
  expect(JSON.stringify(served).length).toBeLessThanOrEqual(50_000)
  expect(JSON.stringify(served)).not.toContain('pppp')
  expect(served.findings[0].test).toEqual({ command: 'c', failure: 'f' })
})

it('a small candidate list drops only the patch and is not marked truncated', async () => {
  const { id } = await reviewing('small', ['src/app/page.tsx'])
  await finish(id, 'ux', { findings: [{ ...finding, class: 'correctness', test: { command: 'c', failure: 'f', patch: 'p' } }] })
  const verify = await claim('reviewer')
  expect(verify.candidates).toEqual([{ job: 'ux', findings: [{ ...finding, class: 'correctness', test: { command: 'c', failure: 'f' } }], open: [] }])
})
