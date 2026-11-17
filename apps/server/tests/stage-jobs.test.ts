import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const exec = vi.hoisted(() => vi.fn())
vi.mock('@bauherr/runner', async (orig) => ({ ...(await orig<typeof import('@bauherr/runner')>()), runStage: exec }))

/** The `audit` stage of fixtures/jobs-pack: security, ux (touches ui, non-blocking) and test in parallel, verify needs all three. */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let advance: typeof import('../src/lib/advance').advance
let finishAgentRun: typeof import('../src/lib/agent-stage').finishAgentRun
let jobs: typeof import('../src/jobs')
const o = { overrideAccess: true } as const
const repo = 'acme/jobs'
const usage = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, costEstimateUsd: 0 }

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/jobs-pack', import.meta.url))
  testDb = await createTestDb('stage_jobs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_URL = 'http://gateway.test'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ;({ advance } = await import('../src/lib/advance'))
  ;({ finishAgentRun } = await import('../src/lib/agent-stage'))
  jobs = await import('../src/jobs')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, pathSets: { ui: ['src/app/**'] } }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const get = async (collection: 'runs' | 'tickets', id: number) => (await payload.findByID({ collection, id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (ticket: number) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket } }, { stage: { equals: 'audit' } }] }, sort: 'id', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const byJob = async (ticket: number, job: string) => (await runsOf(ticket)).filter((r) => r.job === job)
const statuses = async (ticket: number) => Object.fromEntries((await runsOf(ticket)).map((r) => [r.job, r.status]))
const events = async (ticket: number) => (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: ticket } }, sort: ['at', 'id'], depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]

/** A Ticket in build with an MR that changes `files`, taken to `audit` by Build's `done`. */
const audited = async (title: string, files: string[]) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:build'] })
  const id = (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })).id as number
  const head = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(repo, head)
  for (const f of files) fake.commit(repo, head, f, `x${Math.random()}`)
  const pr = await fake.forge.openPullRequest(repo, { title, body: 'Done', head, base: 'main' })
  fake.setChecks(repo, pr.headSha, green)
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', kind: 'build', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  await advance(payload, null, await get('tickets', id), 'done', { by: 'factory' })
  return id
}
const finish = async (ticket: number, job: string, outcome: string) => {
  const run = (await byJob(ticket, job)).at(-1)!
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'succeeded' }, ...o })
  await finishAgentRun(payload, await get('runs', run.id), await get('tickets', ticket), outcome, `${job} says ${outcome}`)
  return run.id as number
}

it('entering the stage starts every Job without needs in parallel, each Run carrying its Job and role', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  expect(await get('tickets', id)).toMatchObject({ stage: 'audit' })
  expect((await runsOf(id)).map((r) => [r.job, r.kind, r.role, r.status])).toEqual([
    ['security', 'agent', 'security', 'queued'],
    ['ux', 'agent', 'ux', 'queued'],
    ['test', 'agent', 'test', 'queued'],
  ])
})

it('a Job whose when does not match is skipped and recorded with its Job; verify waits for the rest', async () => {
  const id = await audited('docs', ['docs/a.md'])
  expect(await statuses(id)).toEqual({ security: 'queued', test: 'queued' })
  expect((await events(id)).filter((e) => e.cause === 'skip:audit').map((e) => [e.job, e.note])).toEqual([['ux', expect.stringContaining('ui')]])
  await finish(id, 'security', 'pass')
  expect(await statuses(id)).toEqual({ security: 'succeeded', test: 'queued' })
  await finish(id, 'test', 'pass')
  expect(await statuses(id)).toMatchObject({ verify: 'queued' })
  expect(await byJob(id, 'verify')).toHaveLength(1)
})

it('when all Jobs are done the stage applies its first outcome; non-blocking findings are only recorded', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  await finish(id, 'ux', 'findings')
  expect(await get('tickets', id)).toMatchObject({ stage: 'audit' })
  await finish(id, 'security', 'pass')
  await finish(id, 'test', 'pass')
  expect(await get('tickets', id)).toMatchObject({ stage: 'audit' })
  expect((await byJob(id, 'verify')).length).toBe(1)
  await finish(id, 'verify', 'pass')
  expect(await get('tickets', id)).toMatchObject({ stage: 'review' })
  expect((await fake.tickets(repo).listComments(String((await get('tickets', id)).number))).some((c) => c.body === '<!-- bauherr:stage:audit/ux -->\nux says findings')).toBe(true)
})

it('a blocking Job that reports findings sends the Ticket to build at once and cancels the other live Runs', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  await finish(id, 'security', 'findings')
  expect(await get('tickets', id)).toMatchObject({ stage: 'build' })
  expect(await statuses(id)).toEqual({ security: 'succeeded', ux: 'cancelled', test: 'cancelled' })
})

it('two blocking Jobs finishing at once send the Ticket to build once', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  await Promise.all([finish(id, 'security', 'findings'), finish(id, 'test', 'findings')])
  expect(await get('tickets', id)).toMatchObject({ stage: 'build' })
  expect(await statuses(id)).toEqual({ security: 'succeeded', ux: 'cancelled', test: 'succeeded' })
  expect((await byJob(id, 'ux'))[0]!.error).toMatch(/^cancelled: (security|test) reported findings$/)
  expect(await runsOf(id)).toHaveLength(3)
})

it('a Run of an earlier visit that finishes late changes nothing', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  const stale = (await byJob(id, 'test'))[0]!
  await finish(id, 'security', 'findings')
  await advance(payload, null, await get('tickets', id), 'done', { by: 'factory' })
  expect(await get('tickets', id)).toMatchObject({ stage: 'audit' })
  expect((await runsOf(id)).filter((r) => r.job === 'test' && r.status === 'queued')).toHaveLength(1)
  await payload.update({ collection: 'runs', id: stale.id, data: { status: 'succeeded' }, ...o })
  await finishAgentRun(payload, await get('runs', stale.id), await get('tickets', id), 'findings')
  expect(await get('tickets', id)).toMatchObject({ stage: 'audit' })
})

it('a new visit starts the Jobs again; a Ticket with no stage_since counts every Run of the stage', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  const { startReadyJobs } = await import('../src/lib/stage-jobs')
  await startReadyJobs(payload, { id })
  expect(await runsOf(id)).toHaveLength(3)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "stage_since" = NULL WHERE "id" = ${id}`)
  await startReadyJobs(payload, { id })
  expect(await runsOf(id)).toHaveLength(3)
  await payload.db.drizzle.execute(sql`UPDATE "runs" SET "status" = 'cancelled' WHERE "ticket_id" = ${id}`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "stage_since" = now() WHERE "id" = ${id}`)
  await startReadyJobs(payload, { id })
  expect(await runsOf(id)).toHaveLength(6)
})

it('an outcome the Job does not have is refused', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  const { assertOutcome } = await import('../src/lib/agent-stage')
  const run = (await byJob(id, 'security'))[0]!
  expect(assertOutcome(run, 'findings')).toBe('findings')
  expect(() => assertOutcome(run, 'maybe')).toThrow(/outcome must be one of pass, findings/)
})

it('an autonomous Job Run gets the skill, role profile and outcomes of its Job', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  const ux = (await byJob(id, 'ux'))[0]!
  exec.mockImplementationOnce(async (ctx: any) => {
    expect(ctx.run).toMatchObject({ kind: 'agent', tier: 'standard' })
    expect(ctx.agent).toMatchObject({ stage: 'audit', skill: 'ux-review', outcomes: ['pass', 'findings'], roleProfile: 'Look at what people see.' })
    return { status: 'succeeded', artifacts: { agentOutcome: { outcome: 'pass' } }, usage }
  })
  await (jobs.runStage.handler as (a: unknown) => Promise<unknown>)({ input: { runId: ux.id }, req: { payload } })
  expect(await get('runs', ux.id)).toMatchObject({ status: 'succeeded', outcome: 'pass', role: 'ux' })
})

const commit = async (ticket: number, job: string, outcome: string) => {
  const run = (await byJob(ticket, job)).at(-1)!
  await payload.update({ collection: 'runs', id: run.id, data: { status: 'succeeded', outcome }, ...o })
}

it('a blocking Job whose findings are recorded but not yet applied is applied by the next pass, not read as done', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  await finish(id, 'ux', 'pass')
  await finish(id, 'test', 'pass')
  await commit(id, 'security', 'findings')
  const { startReadyJobs } = await import('../src/lib/stage-jobs')
  await startReadyJobs(payload, { id })
  expect(await get('tickets', id)).toMatchObject({ stage: 'build' })
  expect(await byJob(id, 'verify')).toHaveLength(0)
})

it('an advance that fails leaves the visit as it was, so the next pass applies the outcome instead of restarting the Jobs', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  const since = async () => ((await payload.db.drizzle.execute(sql`SELECT "stage_since"::text AS s FROM "tickets" WHERE "id" = ${id}`)).rows[0] as { s: string }).s
  const before = await since()
  const forge = fake.tickets(repo)
  const comment = forge.comment.bind(forge)
  const spy = vi.spyOn(forge, 'comment').mockImplementation(async (n, body) => (body.startsWith('<!-- bauherr:worklog') ? Promise.reject(new Error('forge down')) : comment(n, body)))
  await expect(finish(id, 'security', 'findings')).rejects.toThrow('forge down')
  spy.mockRestore()
  expect(await since()).toBe(before)
  expect(await get('tickets', id)).toMatchObject({ stage: 'audit' })
  const { startReadyJobs } = await import('../src/lib/stage-jobs')
  await startReadyJobs(payload, { id })
  expect(await get('tickets', id)).toMatchObject({ stage: 'build' })
  expect(await runsOf(id)).toHaveLength(3)
})

it('liveness sees a failed Job Run although a sibling succeeded after it', async () => {
  const id = await audited('ui', ['src/app/page.tsx'])
  await payload.update({ collection: 'runs', id: (await byJob(id, 'security'))[0]!.id, data: { status: 'failed', error: 'boom' }, ...o })
  await commit(id, 'ux', 'pass')
  await commit(id, 'test', 'pass')
  const { deadTickets } = await import('../src/lib/liveness')
  expect((await deadTickets(payload, ws)).find((d) => d.ticket.id === id)).toMatchObject({ cause: 'run-failed' })
})

it('Job events record each Job Run queued and finished, and stay out of the timeline', async () => {
  const history = await import('../src/lib/history')
  const id = await audited('events', ['src/lib/a.ts'])
  await finish(id, 'security', 'pass')
  const causes = (await events(id)).map((e) => e.cause).filter((c) => String(c).startsWith('job:'))
  expect(causes).toEqual(expect.arrayContaining(['job:security:queued', 'job:test:queued', 'job:security:finished']))
  expect(causes.filter((c) => c === 'job:security:queued')).toHaveLength(1)
  expect((await history.timeline(payload, id)).some((s) => String(s.cause).startsWith('job:'))).toBe(false)
  expect(await history.jobs(payload, id)).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'audit', job: 'security', what: 'finished', outcome: 'pass' })]))
})
