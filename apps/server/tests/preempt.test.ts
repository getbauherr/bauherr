import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { nextStep } from '../src/lib/next-step'
import { DEFAULT } from '../src/lib/workflow'
import { ticketStatus } from '../src/app/(app)/lib/status'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Doc
let jobs: typeof import('../src/jobs')
let preempt: typeof import('../src/lib/preempt')
let wip: typeof import('../src/lib/wip')
let escalation: typeof import('../src/lib/escalation')
let call: (name: string, input?: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/seed'
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb('preempt_583')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  preempt = await import('../src/lib/preempt')
  wip = await import('../src/lib/wip')
  escalation = await import('../src/lib/escalation')
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  user = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input = {}) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const db = () => payload.db.drizzle
const rows = async (q: ReturnType<typeof sql>) => (await db().execute(q)).rows as Doc[]
const runRow = async (id: number | string) => (await rows(sql`SELECT * FROM "runs" WHERE "id" = ${id}`))[0]!

beforeEach(async () => {
  await db().execute(sql`TRUNCATE "runs", "tickets", "agent_sessions" CASCADE`)
  await payload.update({ collection: 'workspaces', id: ws, data: { preemptForHotfix: true, wipLimits: {}, expediteLane: true }, ...o })
})

/** An open Ticket in `stage` with an awaiting_session Run of that stage. */
const ticket = async (title: string, stage: string, extra: Doc = {}) => {
  const labels = [`bauherr:stage:${stage}`]
  const issue = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, labels, product, workspace: ws, rank: title, ...extra }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
  return { id: t.id as number, number: issue.number as number, run: run.id as number }
}
const session = async (key: string) => (await call('connect', { role: 'engineer', session: key, label: key })).sessionId as string
/** The session claims its next Run through `next_work`. */
const work = async (sessionId: string) => (await call('next_work', { sessionId })).work as Doc

/** Two engineer sessions, each holding a Build Run (a before b, so b started last). */
const busy = async () => {
  const [a, b] = [await ticket('a-build', 'build'), await ticket('b-build', 'build')]
  const [sa, sb] = [await session('sa'), await session('sb')]
  const wa = await work(sa)
  await new Promise((r) => setTimeout(r, 5))
  const wb = await work(sb)
  expect([wa.run.id, wb.run.id].sort()).toEqual([a.run, b.run].sort())
  return { sa, sb, wa, wb }
}
const hotfix = () => ticket('hotfix', 'plan', { expedite: true })

describe('AC1: one victim, told in every answer', () => {
  it('marks only the session that started last; its answers carry preempt; after release the hotfix comes first', async () => {
    const { sa, sb, wa, wb } = await busy()
    const hot = await hotfix()
    expect(await preempt.preemptSweep(payload)).toBe(1)
    expect(await preempt.preemptSweep(payload)).toBe(0)
    expect(await rows(sql`SELECT "id" FROM "runs" WHERE "preempt_at" IS NOT NULL`)).toEqual([{ id: wb.run.id }])

    const hb = await call('heartbeat', { sessionId: sb, runId: wb.run.id, leaseToken: wb.leaseToken })
    expect(hb.preempt).toEqual({ ticket: hot.id, run: hot.run, reason: `hotfix #${hot.number}` })
    const step = await call('report_step', { sessionId: sb, runId: wb.run.id, leaseToken: wb.leaseToken, summary: 'handoff' })
    expect(step.preempt).toMatchObject({ run: hot.run })
    expect((await call('heartbeat', { sessionId: sa, runId: wa.run.id, leaseToken: wa.leaseToken })).preempt).toBeUndefined()

    await call('release_run', { sessionId: sb, runId: wb.run.id, leaseToken: wb.leaseToken })
    expect(await runRow(wb.run.id)).toMatchObject({ status: 'awaiting_session', reason_kind: 'preempted', preempt_at: null, preempted_by: String(hot.run) })
    const next = await work(sb)
    expect(next.run.id).toBe(hot.run)
    expect((await call('heartbeat', { sessionId: sb, runId: hot.run, leaseToken: next.leaseToken })).preempt).toBeUndefined()
  })

  it('never more than one victim per hotfix, and never an expedite Run', async () => {
    const { wa, wb } = await busy()
    const last = [wa, wb].find((w) => w.run.id === Math.max(wa.run.id, wb.run.id))!
    await db().execute(sql`UPDATE "tickets" SET "expedite" = true WHERE "id" = ${last.ticket.id}`)
    const hot = await hotfix()
    const hotRun = (await payload.findByID({ collection: 'runs', id: hot.run, ...o })) as Doc
    const hotTicket = (await payload.findByID({ collection: 'tickets', id: hot.id, ...o })) as Doc
    const victim = await preempt.markPreempt(payload, hotRun, hotTicket)
    expect(victim).not.toBeNull()
    expect(victim).not.toBe(last.run.id)
    expect(await preempt.markPreempt(payload, hotRun, hotTicket)).toBeNull()
    expect(await rows(sql`SELECT "id" FROM "runs" WHERE "preempted_by" = ${hot.run}`)).toHaveLength(1)
  })
})

describe('AC2: the sweep forces after 2 minutes', () => {
  it('abandons as preempted with a successor, no escalation, WIP unchanged', async () => {
    const { wb } = await busy()
    const before = await wip.wipCount(payload, ws, 'build')
    const hot = await hotfix()
    await preempt.preemptSweep(payload)
    expect(await jobs.expireStaleSessions(payload, Date.now() + 60_000)).toBe(0)
    expect((await runRow(wb.run.id)).status).toBe('running')
    expect(await jobs.expireStaleSessions(payload, Date.now() + preempt.PREEMPT_GRACE_MS + 5_000)).toBe(1)
    expect(await runRow(wb.run.id)).toMatchObject({ status: 'abandoned', reason_kind: 'preempted' })
    const succ = (await rows(sql`SELECT * FROM "runs" WHERE "previous_run_id" = ${wb.run.id}`))[0]!
    expect(succ).toMatchObject({ status: 'awaiting_session', escalation: null, preempted_by: String(hot.run) })
    expect(await wip.wipCount(payload, ws, 'build')).toBe(before)
    const t = (await payload.findByID({ collection: 'tickets', id: wb.ticket.id, ...o })) as Doc
    expect(t.stage).toBe('build')
    expect(await escalation.escalate(payload, t, (await payload.findByID({ collection: 'runs', id: wb.run.id, ...o })) as Doc, 'x')).toBe(false)
    expect(await rows(sql`SELECT 1 FROM "runs" WHERE "previous_run_id" = ${succ.id}`)).toHaveLength(0)
  })

  it('two preemptions in a row are not needs_human; a plain abandon after one is not either', async () => {
    const t = await ticket('twice', 'build')
    await db().execute(sql`UPDATE "runs" SET "status" = 'abandoned', "reason_kind" = 'preempted', "error" = 'p', "preempted_by" = 1, "preempted_for" = 7 WHERE "id" = ${t.run}`)
    const next = async (preempted: boolean) => {
      const prev = (await rows(sql`SELECT "id" FROM "runs" WHERE "ticket_id" = ${t.id} AND "status" = 'abandoned' ORDER BY "id" DESC LIMIT 1`))[0]!.id
      const r = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'running', mode: 'session', workspace: ws, previousRun: prev, preemptedBy: 1, preemptedFor: 7 }, ...o })
      return jobs.abandonRun(payload, r, { reason: 'x', escalate: true, preempted })
    }
    expect(await next(true)).toBe('abandoned')
    expect(await next(false)).toBe('abandoned')
    expect(await next(false)).toBe('needs_human')
  })
})

describe('AC3: no victim when it is not needed or not wanted', () => {
  it('a free connected session means nobody is preempted', async () => {
    await busy()
    await session('sc')
    await hotfix()
    expect(await preempt.preemptSweep(payload)).toBe(0)
    expect(await rows(sql`SELECT 1 FROM "runs" WHERE "preempt_at" IS NOT NULL`)).toHaveLength(0)
  })

  it('switch off means nobody is preempted', async () => {
    await busy()
    await payload.update({ collection: 'workspaces', id: ws, data: { preemptForHotfix: false }, ...o })
    await hotfix()
    expect(await preempt.preemptSweep(payload)).toBe(0)
  })
})

describe('resume first', () => {
  it('the successor sorts before an earlier-ranked Ticket of its stage once the hotfix is done', async () => {
    const [x, y] = [await ticket('a-other', 'build'), await ticket('z-victim', 'build')]
    const sa = await session('sa')
    const sb = await session('sb')
    const wa = await work(sa)
    const wb = await work(sb)
    expect([wa.run.id, wb.run.id].sort()).toEqual([x.run, y.run].sort())
    const hot = await hotfix()
    await preempt.preemptSweep(payload)
    const victim = (await rows(sql`SELECT "id", "ticket_id" FROM "runs" WHERE "preempt_at" IS NOT NULL`))[0]!
    await jobs.expireStaleSessions(payload, Date.now() + preempt.PREEMPT_GRACE_MS + 5_000)
    const successor = (await rows(sql`SELECT "id", "ticket_id" FROM "runs" WHERE "previous_run_id" = ${victim.id}`))[0]!
    const other = await ticket('a-late', 'build')
    await db().execute(sql`UPDATE "runs" SET "status" = 'succeeded' WHERE "id" = ${hot.run}`)
    const claimed = await call('claim_next', { sessionId: sb, stages: ['build'] })
    expect(claimed.run.id).toBe(successor.id)
    expect((await runRow(successor.id)).preempted_for).toBeNull()
    expect(claimed.run.id).not.toBe(other.run)
  })
})

describe('words', () => {
  it('the Ticket reads "Paused for hotfix #n", the hotfix "Starting: ... pausing #m, up to 2 min"', () => {
    const run = { id: 5, stage: 'build', status: 'awaiting_session', createdAt: '', mode: 'session', preemptedFor: 7 }
    const s = ticketStatus(DEFAULT(), { open: true, stage: 'build', needsYou: null, blockedBy: [], queuedWhy: null, run, owner: null, forge: null, gate: null, track: {} })
    expect(s.label).toBe('Paused for hotfix #7')
    const base = { wf: DEFAULT(), ticket: { stage: 'build' }, need: null, waiting: null, blockers: [], admin: false }
    expect(nextStep({ ...base, run: { id: 5, stage: 'build', status: 'awaiting_session', preemptedFor: 7 } }).reason).toContain('Paused for hotfix #7')
    expect(nextStep({ ...base, ticket: { stage: 'plan' }, run: { id: 6, stage: 'plan', status: 'awaiting_session', pausing: 3 } }).reason).toBe('Starting: Software engineer session pausing #3, up to 2 min.')
  })
})
