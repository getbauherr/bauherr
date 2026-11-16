import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Doc
let sessions: typeof import('../src/lib/sessions')
let call: (name: string, input?: unknown) => Promise<any>
const o = { overrideAccess: true } as const
let repo = ''

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('team_data')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  sessions = await import('../src/lib/sessions')
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  user = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input = {}) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  repo = 'acme/seed'
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const db = () => payload.db.drizzle
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString()

beforeEach(async () => {
  await db().execute(sql`DELETE FROM "usage_entries"`)
  await db().execute(sql`DELETE FROM "steps"`)
  await db().execute(sql`DELETE FROM "session_spans"`)
  await db().execute(sql`UPDATE "runs" SET "session_id" = NULL`)
  await db().execute(sql`DELETE FROM "agent_sessions"`)
  await db().execute(sql`DELETE FROM "agent_keys"`)
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
})

let n = 0
const ticket = async (stage: string, opts: { state?: string; runStatus?: string; mode?: string } = {}) => {
  const title = `t${++n}`
  const issue = await fake.tickets(repo).create({ title, labels: [`bauherr:stage:${stage}`] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: opts.state ?? 'open', stage, labels: [`bauherr:stage:${stage}`], product, workspace: ws, rank: title }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: opts.runStatus ?? 'awaiting_session', mode: opts.mode ?? 'session', workspace: ws }, ...o })
  return { id: t.id as number, number: issue.number, title, run: run.id as number }
}
const team = async (opts: Doc = {}) => sessions.loadTeam(payload, ws, opts)
const engineer = async (opts: Doc = {}) => (await team(opts)).roles.find((r) => r.id === 'engineer')!
const claim = async (stage = 'build') => {
  const t = await ticket(stage)
  const s = await call('connect', { role: 'engineer', session: `k${++n}` })
  expect((await call('next_work', { sessionId: s.sessionId })).work.run.id).toBe(t.run)
  return { t, publicId: s.sessionId as string }
}
const sid = async (publicId: string) => ((await db().execute(sql`SELECT "id" FROM "agent_sessions" WHERE "public_id" = ${publicId}`)).rows[0] as Doc).id as number

describe('sessionHealth', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  const at = (s: number) => new Date(now - s * 1000).toISOString()
  const h = (hasRun: boolean, lastSeen: string | null, disconnectedAt: string | null = null) => sessions.sessionHealth({ hasRun, lastSeenAt: lastSeen, disconnectedAt }, now, 600)
  it.each([
    ['working: a Run and a recent signal', true, 30, null, 'working'],
    ['idle: no Run and a recent signal', false, 30, null, 'idle'],
    ['stuck: a running Run, silent past the timeout', true, 601, null, 'stuck'],
    ['not responding: idle, silent past the timeout', false, 601, null, 'not-responding'],
    ['disconnected beats everything', true, 5, 1, 'disconnected'],
    ['disconnected after a timeout', false, 900, 100, 'disconnected'],
  ] as const)('%s', (_, run, seen, gone, want) => expect(h(run, at(seen), gone == null ? null : at(gone))).toBe(want))
  it('the timeout itself is not silent yet; a session that never reported is', () => {
    expect(h(true, at(600))).toBe('working')
    expect(h(false, null)).toBe('not-responding')
  })
  it('defaults to sessionTimeoutS and the current time', () => {
    expect(sessions.sessionHealth({ hasRun: false, lastSeenAt: new Date().toISOString(), disconnectedAt: null })).toBe('idle')
    expect(sessions.sessionHealth({ hasRun: true, lastSeenAt: ago(sessions.sessionTimeoutS() + 5), disconnectedAt: null })).toBe('stuck')
  })
})

describe('loadTeam: waiting work', () => {
  it('counts open Tickets with a Run waiting for a session per role', async () => {
    await ticket('build')
    await ticket('build')
    await ticket('review')
    expect((await engineer()).waiting).toBe(2)
    expect((await team()).roles.find((r) => r.id === 'reviewer')!.waiting).toBe(1)
  })
  it('skips Tickets a session holds, closed Tickets and Runner/CI work', async () => {
    await ticket('build', { runStatus: 'running' })
    await ticket('build', { state: 'closed' })
    await ticket('build', { mode: 'autonomous', runStatus: 'queued' })
    expect((await engineer()).waiting).toBe(0)
  })
  it('a Ticket whose Run belongs to an earlier stage is not waiting', async () => {
    const t = await ticket('plan')
    await db().execute(sql`UPDATE "tickets" SET "stage" = 'build' WHERE "id" = ${t.id}`)
    expect((await engineer()).waiting).toBe(0)
  })
})

describe('loadTeam: key presence', () => {
  const key = (revoked = false) => payload.create({ collection: 'agent_keys', data: { owner: user.id, label: 'k', keyHash: `h${++n}`, prefix: 'bk_', ...(revoked && { revokedAt: new Date().toISOString() }) } as never, ...o })
  it('false without a key or a user, true with an unrevoked key of that person', async () => {
    expect((await team({ userId: user.id })).presence.key).toBe(false)
    await key(true)
    expect((await team({ userId: user.id })).presence.key).toBe(false)
    await key()
    expect((await team({ userId: user.id })).presence.key).toBe(true)
    expect((await team()).presence.key).toBe(false)
  })
  it('anySession stays true for a session disconnected long ago', async () => {
    expect((await team()).presence.anySession).toBe(false)
    const { publicId } = await claim()
    await db().execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now() - interval '3 days' WHERE "public_id" = ${publicId}`)
    const t = await team()
    expect(t.roles.flatMap((r) => r.sessions)).toHaveLength(0)
    expect(t.presence.anySession).toBe(true)
  })
})

describe('loadTeam: session fields', () => {
  it('a working session carries its Run start and the activity word of the stage kind', async () => {
    const { publicId } = await claim()
    await db().execute(sql`UPDATE "runs" SET "started_at" = now() - interval '12 minutes' WHERE "status" = 'running'`)
    const s = (await engineer()).sessions.find((x) => x.publicId === publicId)!
    expect(s).toMatchObject({ status: 'working', health: 'working', activity: 'building' })
    expect(Date.now() - Date.parse(s.runStartedAt!)).toBeGreaterThan(11 * 60_000)
    expect(Date.now() - Date.parse(s.runStartedAt!)).toBeLessThan(13 * 60_000)
  })
  it('an idle session has no Run fields', async () => {
    const { session } = { session: await call('connect', { role: 'engineer' }) }
    const s = (await engineer()).sessions.find((x) => x.publicId === session.sessionId)!
    expect(s).toMatchObject({ health: 'idle', disconnectedAt: null, endReason: null })
    expect(s.activity).toBeUndefined()
    expect(s.runStartedAt).toBeUndefined()
  })
  it('a silent session is stuck with a Run and not responding without one', async () => {
    const { publicId } = await claim()
    const idle = await call('connect', { role: 'engineer' })
    await db().execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now() - interval '20 minutes'`)
    const by = Object.fromEntries((await engineer()).sessions.map((x) => [x.publicId, x.health]))
    expect(by).toEqual({ [publicId]: 'stuck', [idle.sessionId]: 'not-responding' })
  })
  it('a disconnected session has disconnectedAt and endReason', async () => {
    const a = await call('connect', { role: 'engineer', session: 'a' })
    await call('disconnect', { sessionId: a.sessionId })
    const b = await call('connect', { role: 'engineer', session: 'b' })
    await db().execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now(), "end_reason" = 'timeout' WHERE "public_id" = ${b.sessionId}`)
    const rows = Object.fromEntries((await engineer()).sessions.map((x) => [x.publicId, x]))
    expect(rows[a.sessionId]).toMatchObject({ health: 'disconnected', endReason: 'disconnect' })
    expect(rows[a.sessionId]!.disconnectedAt).toMatch(/^\d{4}-/)
    expect(rows[b.sessionId]).toMatchObject({ health: 'disconnected', endReason: 'timeout' })
  })
  it('the key owner is returned to an Admin only', async () => {
    await call('connect', { role: 'engineer' })
    expect((await engineer({ admin: true })).sessions[0]!.keyOwner).toBe('m@x.io')
    expect('keyOwner' in (await engineer()).sessions[0]!).toBe(false)
  })
  it('role stages carry the activity word of their kind', async () => {
    expect((await engineer()).stages.map((s) => [s.name, s.activity])).toEqual([['plan', 'planning'], ['build', 'building']])
  })
})

describe('loadSession', () => {
  it('an unknown id and one of another Workspace are null', async () => {
    const { publicId } = await claim()
    expect(await sessions.loadSession(payload, ws, 'ses_nope')).toBeNull()
    expect(await sessions.loadSession(payload, ws + 999, publicId)).toBeNull()
  })

  it('returns the session with its role, current Run and health', async () => {
    const { publicId, t } = await claim()
    const v = (await sessions.loadSession(payload, ws, publicId))!
    expect(v.session).toMatchObject({ publicId, role: 'engineer', health: 'working', activity: 'building', run: t.run, ticket: { number: t.number, title: t.title, stage: 'build' } })
  })

  it('lists the Runs newest first with ticket, stage, outcome, duration and cost, also a released one', async () => {
    const { publicId, t } = await claim()
    const id = await sid(publicId)
    const old = await ticket('review', { runStatus: 'succeeded' })
    await db().execute(sql`UPDATE "runs" SET "outcome" = 'approve', "started_at" = now() - interval '2 hours', "finished_at" = now() - interval '2 hours' + interval '90 seconds', "session_id" = NULL WHERE "id" = ${old.run}`)
    await db().execute(sql`INSERT INTO "session_spans" ("workspace_id", "session_id", "run_id", "ticket_id", "started_at", "last_at") VALUES (${ws}, ${id}, ${old.run}, ${old.id}, now() - interval '2 hours', now() - interval '2 hours')`)
    await db().execute(sql`UPDATE "runs" SET "started_at" = now() - interval '10 minutes' WHERE "id" = ${t.run}`)
    await db().execute(sql`INSERT INTO "usage_entries" ("workspace_id", "run_id", "ticket_id", "session_id", "stage", "role", "model", "tokens_in", "tokens_out", "cost_usd", "source", "at") VALUES (${ws}, ${old.run}, ${old.id}, ${id}, 'review', 'engineer', 'm', 100, 50, 0.25, 'session-reported', now())`)
    const v = (await sessions.loadSession(payload, ws, publicId, { admin: true }))!
    expect(v.runs.map((r) => r.id)).toEqual([t.run, old.run])
    expect(v.runs[0]).toMatchObject({ ticket: { number: t.number, title: t.title }, stage: 'build', status: 'running', outcome: null, finishedAt: null })
    expect(v.runs[0]!.durationSeconds).toBeGreaterThanOrEqual(600)
    expect(v.runs[1]).toMatchObject({ stage: 'review', status: 'succeeded', outcome: 'approve', durationSeconds: 90, costUsd: 0.25 })
  })

  it('returns the last 10 milestones across Runs, newest first, with their Run', async () => {
    const { publicId, t } = await claim()
    for (let i = 1; i <= 12; i++) await payload.create({ collection: 'steps', data: { run: t.run, workspace: ws, seq: i, summary: `step ${i}`, startedAt: ago(1000 - i) } as never, ...o })
    const other = await ticket('build')
    await payload.create({ collection: 'steps', data: { run: other.run, workspace: ws, seq: 1, summary: 'foreign', startedAt: ago(1) } as never, ...o })
    const m = (await sessions.loadSession(payload, ws, publicId))!.milestones
    expect(m).toHaveLength(10)
    expect(m.map((x) => x.summary)).toEqual(Array.from({ length: 10 }, (_, i) => `step ${12 - i}`))
    expect(m[0]).toMatchObject({ run: t.run, seq: 12 })
  })

  it('an Admin gets cost and tokens today and in 30 days; older rows only count in 30 days, rows after 30 days not at all', async () => {
    const { publicId, t } = await claim()
    const id = await sid(publicId)
    const put = (c: number, at: string) => db().execute(sql`INSERT INTO "usage_entries" ("workspace_id", "run_id", "ticket_id", "session_id", "stage", "role", "model", "tokens_in", "tokens_out", "cost_usd", "source", "at") VALUES (${ws}, ${t.run}, ${t.id}, ${id}, 'build', 'engineer', ${`m${c}`}, 100, 50, ${c}, 'session-reported', ${at}::timestamptz)`)
    await put(1, new Date().toISOString())
    await put(2, ago(5 * 86400))
    await put(4, ago(40 * 86400))
    const v = (await sessions.loadSession(payload, ws, publicId, { admin: true, now: Date.now() }))!
    expect(v.usage!.d30).toEqual({ usd: 3, tokens: 300 })
    expect(v.usage!.today.usd).toBeLessThanOrEqual(3)
    expect(v.usage!.today.tokens).toBe(v.usage!.today.usd === 3 ? 300 : 150)
  })

  it('an Admin gets client, model, provider and key owner', async () => {
    const s = await call('connect', { role: 'engineer', model: 'm1', client: 'claude-code/2.1' })
    const v = (await sessions.loadSession(payload, ws, s.sessionId, { admin: true }))!
    expect(v.session).toMatchObject({ clientName: 'claude-code', clientVersion: '2.1', model: 'm1', keyOwner: 'm@x.io' })
    expect('provider' in v.session).toBe(true)
  })

  it('a non-Admin gets no cost, tokens, client, model, provider or key owner field at all', async () => {
    const { publicId, t } = await claim()
    await db().execute(sql`UPDATE "agent_sessions" SET "model" = 'm1', "client_name" = 'claude-code', "provider" = 'p'`)
    await db().execute(sql`INSERT INTO "usage_entries" ("workspace_id", "run_id", "ticket_id", "session_id", "stage", "role", "model", "tokens_in", "tokens_out", "cost_usd", "source", "at") VALUES (${ws}, ${t.run}, ${t.id}, ${await sid(publicId)}, 'build', 'engineer', 'm', 100, 50, 1, 'session-reported', now())`)
    const v = (await sessions.loadSession(payload, ws, publicId))!
    for (const k of ['clientName', 'clientVersion', 'model', 'provider', 'keyOwner']) expect(k in v.session, k).toBe(false)
    expect('usage' in v).toBe(false)
    expect(v.runs.every((r) => !('costUsd' in r))).toBe(true)
    expect(JSON.stringify(v)).not.toMatch(/costUsd|tokens"|claude-code|"m1"|m@x\.io/)
  })
})
