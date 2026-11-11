import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { parse, stringify } from 'yaml'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Doc
let llmSlug: string
let factory: typeof import('../src/lib/factory')
let sessions: typeof import('../src/lib/sessions')
let call: (name: string, input?: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const by = { by: 'admin@x.io', via: 'api' } as const
let repo = ''
let n = 0

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('agent_sessions')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  factory = await import('../src/lib/factory')
  sessions = await import('../src/lib/sessions')
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  llmSlug = ((await payload.create({ collection: 'connections', data: { name: 'llm', kind: 'llm-provider', provider: 'bedrock', awsRegion: 'us-east-1', workspace: ws }, ...o })) as Doc).slug
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
const rows = async (q: ReturnType<typeof sql>) => (await db().execute(q)).rows as Doc[]
const editRoles = async (fn: (roles: Doc) => void) => {
  const d = parse(await factory.exportFactory(payload, ws)) as Doc
  fn(d.team.roles)
  expect(await factory.applyFactory(payload, ws, stringify(d), by)).toMatchObject({ ok: true })
}

beforeEach(async () => {
  await db().execute(sql`DELETE FROM "session_spans"`)
  await db().execute(sql`UPDATE "runs" SET "session_id" = NULL`)
  await db().execute(sql`DELETE FROM "agent_sessions"`)
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
  await editRoles((roles) => {
    for (const r of Object.values(roles) as Doc[]) delete r.agents
    Object.assign(roles.engineer, { tier: 'cheap' })
    delete roles.engineer.provider
    delete roles.engineer.model
  })
})

/** An open Ticket on the fake forge; `run` adds an awaiting_session Run of `runStage`, `stage` leaves the Ticket in that stage (none = untriaged). */
const ticket = async (title: string, stage: string | null, opts: { run?: string | false; runStatus?: string } = {}) => {
  const labels = stage ? [`bauherr:stage:${stage}`] : []
  const issue = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', ...(stage && { stage }), labels, product, workspace: ws, rank: title }, ...o })
  const runStage = opts.run === undefined ? stage : opts.run
  const run = runStage ? await payload.create({ collection: 'runs', data: { ticket: t.id, stage: runStage, status: opts.runStatus ?? 'awaiting_session', mode: 'session', workspace: ws }, ...o }) : null
  return { id: t.id as number, number: issue.number, run }
}
const connect = (role: string, extra: Doc = {}) => call('connect', { role, ...extra })
const row = async (publicId: string) => (await payload.find({ collection: 'agent_sessions', where: { publicId: { equals: publicId } }, limit: 1, ...o })).docs[0] as Doc
const runRow = async (id: number | string) => (await rows(sql`SELECT * FROM "runs" WHERE "id" = ${id}`))[0]

describe('connect', () => {
  it('an unknown role is an error that lists the valid roles with their titles', async () => {
    await expect(connect('wizard')).rejects.toThrow(/valid roles: orchestrator \(Orchestrator\), engineer \(Software engineer\), reviewer \(Reviewer\), security \(Security specialist\), ux \(UX specialist\), test \(Test specialist\)/)
  })

  it('returns the role profile, its stages and the poll hint', async () => {
    const r = await connect('engineer', { model: 'm1', client: 'claude-code/2.1' })
    expect(r.sessionId).toMatch(/^ses_/)
    expect(r.role).toMatchObject({ id: 'engineer', title: 'Software engineer', model: { tier: 'cheap' } })
    expect(r.role.profile).toContain('Mission: turn a Ticket into a plan')
    expect(r.role.skills).toEqual(['Implementation', 'Small diffs', 'Tests first', 'Refactoring'])
    expect(r.role.stages.map((s: Doc) => [s.name, s.kind, s.skill])).toEqual([['plan', 'plan', 'run-contract'], ['build', 'build', 'run-contract']])
    expect(r.role.stages[1].outcomes).toEqual(['done', 'stuck', 'replan'])
    expect(r.pollAfterSeconds).toBeGreaterThan(0)
    expect(r.next).toBe('Call next_work with this sessionId.')
    expect(await row(r.sessionId)).toMatchObject({ role: 'engineer', model: 'm1', clientName: 'claude-code', clientVersion: '2.1' })
  })

  it('a role that names a model gets a hint unless the session already runs on it', async () => {
    await editRoles((roles) => {
      delete roles.engineer.tier
      Object.assign(roles.engineer, { provider: llmSlug, model: 'claude-x' })
    })
    const off = await connect('engineer', { model: 'claude-y' })
    expect(off.role.model).toEqual({ provider: llmSlug, model: 'claude-x' })
    expect(off.modelHint).toBe(`This role runs on claude-x (${llmSlug}). If you are not on it, do each Run's work in one subagent on that model if your client can; otherwise continue and the Run records the model you report.`)
    expect((await connect('engineer')).modelHint).toContain('claude-x')
    expect((await connect('engineer', { model: 'claude-x' })).modelHint).toBeUndefined()
  })

  it('a tier role names the Workspace model of its tier', async () => {
    expect((await connect('reviewer', { model: 'other' })).modelHint).toContain('claude-sonnet-5-5')
  })

  it('the same session key revives the same row and releases the Runs the old process held', async () => {
    const a = await connect('engineer', { session: 'laptop' })
    const t = await ticket('x', 'build')
    expect((await call('next_work', { sessionId: a.sessionId })).work.run.id).toBe(t.run!.id)
    await call('disconnect', { sessionId: a.sessionId })
    expect(await row(a.sessionId)).toMatchObject({ endReason: 'disconnect' })
    expect((await runRow(t.run!.id)).status).toBe('awaiting_session')
    const b = await connect('engineer', { session: 'laptop' })
    expect(b.sessionId).toBe(a.sessionId)
    expect((await row(a.sessionId)).disconnectedAt).toBeNull()
    expect((await row(a.sessionId)).endReason).toBeNull()
    expect(await rows(sql`SELECT 1 FROM "agent_sessions"`)).toHaveLength(1)
    await call('next_work', { sessionId: b.sessionId })
    expect((await connect('engineer', { session: 'laptop' })).sessionId).toBe(a.sessionId)
    expect((await runRow(t.run!.id)).status).toBe('awaiting_session')
  })

  it('a bad or ended sessionId asks the client to connect again', async () => {
    await expect(call('heartbeat', { sessionId: 'ses_nope', runId: 1, leaseToken: 'x' })).rejects.toThrow(/unknown session ses_nope; call connect again/)
    const a = await connect('engineer')
    await call('disconnect', { sessionId: a.sessionId })
    await expect(call('next_work', { sessionId: a.sessionId })).rejects.toThrow(/has ended \(disconnect\); call connect again/)
  })
})

it('a role of the pack default (profile_file, never applied) still gets its profile text', async () => {
  const w = await import('../src/lib/workflow')
  const engineer = w.DEFAULT().roles.find((r) => r.id === 'engineer')!
  expect(engineer.profile).toBeUndefined()
  expect(sessions.profileOf(engineer)).toContain('Mission: turn a Ticket into a plan')
  expect(sessions.profileOf({ id: 'x', title: 'X', tier: 'cheap' })).toBe('')
})

it('role skills survive apply and export, and reach connect and loadTeam (default empty)', async () => {
  await editRoles((roles) => {
    roles.ux.skills = ['Flows', 'Copy']
    delete roles.test.skills
  })
  expect((parse(await factory.exportFactory(payload, ws)) as Doc).team.roles.ux.skills).toEqual(['Flows', 'Copy'])
  expect((await connect('ux')).role.skills).toEqual(['Flows', 'Copy'])
  expect((await connect('test')).role.skills).toEqual([])
  const team = await sessions.loadTeam(payload, ws)
  expect(team.roles.find((r) => r.id === 'ux')!.skills).toEqual(['Flows', 'Copy'])
  expect(team.roles.find((r) => r.id === 'test')!.skills).toEqual([])
})

describe('next_work', () => {
  it('two roles each get only the stages of their role', async () => {
    const review = await ticket('rev', 'review')
    const build = await ticket('bld', 'build')
    const eng = await connect('engineer', { model: 'claude-e', session: 'e' })
    const rev = await connect('reviewer', { model: 'claude-r', session: 'r' })
    const e = (await call('next_work', { sessionId: eng.sessionId })).work
    expect(e.run.id).toBe(build.run!.id)
    expect(e).toMatchObject({ skill: 'run-contract', outcomes: ['done', 'stuck', 'replan'] })
    expect(e.roleReminder).toMatch(/Software engineer.*Mission: turn a Ticket into a plan/)
    expect(e.leaseToken).toBeTruthy()
    const r = (await call('next_work', { sessionId: rev.sessionId })).work
    expect(r.run.id).toBe(review.run!.id)
    expect(r.skill).toBe('review')
    expect(await runRow(build.run!.id)).toMatchObject({ session_id: (await row(eng.sessionId)).id, role: 'engineer', model: 'claude-e', executor: 'session', status: 'running', session_label: 'e' })
    expect(await runRow(review.run!.id)).toMatchObject({ role: 'reviewer', model: 'claude-r' })
    const events = await rows(sql`SELECT "actor" FROM "ticket_events" WHERE "run_id" = ${build.run!.id} AND "cause" = 'run:claimed'`)
    expect(events[0].actor).toBe('e (engineer)')
  })

  it('a role never receives a stage of another role', async () => {
    await ticket('rev', 'review')
    const eng = await connect('engineer')
    expect(await call('next_work', { sessionId: eng.sessionId })).toEqual({ work: null, reason: 'Nothing queued for Software engineer', pollAfterSeconds: 30 })
  })

  it('a session that still holds a Run gets no second one', async () => {
    await ticket('a', 'build')
    await ticket('b', 'build')
    const eng = await connect('engineer')
    const first = (await call('next_work', { sessionId: eng.sessionId })).work
    expect((await call('next_work', { sessionId: eng.sessionId })).reason).toBe(`You still hold Run ${first.run.id}: finish_run or release_run it first`)
  })

  it('stops at the agents cap of the role', async () => {
    await editRoles((roles) => (roles.engineer.agents = 1))
    await ticket('a', 'build')
    await ticket('b', 'build')
    const [s1, s2] = [await connect('engineer'), await connect('engineer')]
    expect((await call('next_work', { sessionId: s1.sessionId })).work).toBeTruthy()
    expect(await call('next_work', { sessionId: s2.sessionId })).toMatchObject({ work: null, reason: 'Software engineer is at its limit of 1 agent' })
  })

  it('says when a stage waits for its WIP limit', async () => {
    const t = await ticket('held', 'plan', { run: false })
    await payload.update({ collection: 'tickets', id: t.id, data: { waitingFor: 'build' }, ...o })
    const eng = await connect('engineer')
    expect((await call('next_work', { sessionId: eng.sessionId })).reason).toBe('Build is at its WIP limit')
  })

  it('claim_next without a sessionId behaves as before and leaves the Run unattached', async () => {
    const t = await ticket('legacy', 'build')
    const r = await call('claim_next', {})
    expect(r.run.id).toBe(t.run!.id)
    expect(await runRow(t.run!.id)).toMatchObject({ session_id: null, role: null, status: 'running' })
    expect((await call('heartbeat', { runId: t.run!.id, leaseToken: r.leaseToken })).ok).toBe(true)
    expect(await rows(sql`SELECT 1 FROM "session_spans"`)).toHaveLength(0)
  })

  it('claim_next with a sessionId stamps the Run with the session and its role', async () => {
    const t = await ticket('stamped', 'build')
    const eng = await connect('engineer', { model: 'claude-e' })
    await call('claim_next', { sessionId: eng.sessionId })
    expect(await runRow(t.run!.id)).toMatchObject({ session_id: (await row(eng.sessionId)).id, role: 'engineer', model: 'claude-e' })
  })

  it('heartbeat with a sessionId stamps a Run claimed the legacy way', async () => {
    const t = await ticket('late', 'build')
    const r = await call('claim_next', {})
    const eng = await connect('engineer')
    await call('heartbeat', { runId: t.run!.id, leaseToken: r.leaseToken, sessionId: eng.sessionId })
    expect(await runRow(t.run!.id)).toMatchObject({ session_id: (await row(eng.sessionId)).id, role: 'engineer' })
    expect(await rows(sql`SELECT 1 FROM "session_spans"`)).toHaveLength(1)
  })
})

it('next_work hands a custom agent stage to the role that owns it, with the stage skill and outcomes', async () => {
  const { readFileSync } = await import('node:fs')
  const dir = new URL('./fixtures/custom-pack', import.meta.url).pathname
  process.env.BAUHERR_PACK_DIR = dir
  try {
    expect(await factory.applyFactory(payload, ws, readFileSync(`${dir}/factory.yaml`, 'utf8'), by)).toMatchObject({ ok: true })
    const t = await ticket('needs a security look', 'security')
    const eng = await connect('engineer')
    expect((await call('next_work', { sessionId: eng.sessionId })).work).toBeNull()
    const sec = await connect('security', { model: 'm-s' })
    expect(sec.role.stages.map((x: Doc) => [x.name, x.kind])).toEqual([['security', 'agent']])
    const w = (await call('next_work', { sessionId: sec.sessionId })).work
    expect(w.run.id).toBe(t.run!.id)
    expect(w).toMatchObject({ skill: 'security-review', agent: { stage: 'security' } })
    expect([...w.outcomes].sort()).toEqual(['findings', 'pass', 'unclear'])
    expect(await runRow(t.run!.id)).toMatchObject({ role: 'security', kind: 'agent', model: 'm-s' })
  } finally {
    delete process.env.BAUHERR_PACK_DIR
    await db().execute(sql`UPDATE "runs" SET "session_id" = NULL`)
    await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
    await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
    expect(await factory.applyFactory(payload, ws, factory.packSource(), by)).toMatchObject({ ok: true })
  }
})

describe('exceptions role', () => {
  /** What the liveness sweep stores for a stuck Ticket. */
  const finding = (id: number, cause: string, ageMs = 0) => db().execute(sql`UPDATE "tickets" SET "liveness" = ${JSON.stringify({ cause, need: null, at: new Date(Date.now() - ageMs).toISOString() })}::jsonb WHERE "id" = ${id}`)
  /** Counts every call into the fake forge while `fn` runs. */
  const forgeCalls = async (fn: () => Promise<unknown>): Promise<number> => {
    let n = 0
    const restore: (() => void)[] = []
    const wrap = (obj: any, keys: string[]) => {
      for (const k of keys) {
        const orig = obj[k]
        if (typeof orig !== 'function') continue
        obj[k] = (...a: unknown[]) => (n++, orig.apply(obj, a))
        restore.push(() => delete obj[k])
      }
    }
    wrap(fake.forge, [...Object.getOwnPropertyNames(Object.getPrototypeOf(fake.forge)), ...Object.keys(fake.forge)].filter((k) => k !== 'constructor'))
    wrap(fake, ['tickets'])
    try {
      await fn()
    } finally {
      restore.forEach((r) => r())
    }
    return n
  }

  it('receives a stuck Ticket only when nothing normal is claimable, never a human gate, and reads no forge', async () => {
    const dead = await ticket('stuck', 'build', { runStatus: 'failed' })
    await finding(dead.id, 'run-failed')
    const triage = await ticket('fresh', null, { run: 'triage' })
    const orch = await connect('orchestrator')
    const first = await call('next_work', { sessionId: orch.sessionId })
    expect(first.work.run.id).toBe(triage.run!.id)
    expect(first.exception).toBeUndefined()
    await call('finish_run', { runId: triage.run!.id, leaseToken: first.work.leaseToken, status: 'failed', reason: 'x', sessionId: orch.sessionId })
    await payload.update({ collection: 'runs', id: triage.run!.id, data: { status: 'succeeded' }, ...o })
    await db().execute(sql`UPDATE "tickets" SET "state" = 'closed' WHERE "id" = ${triage.id}`)
    let second: Doc = {}
    expect(await forgeCalls(async () => void (second = await call('next_work', { sessionId: orch.sessionId })))).toBe(0)
    expect(second.work).toBeNull()
    expect(second.exception).toMatchObject({ ticket: { number: dead.number, stage: 'build' }, problem: expect.stringContaining('run-failed'), allowed: [] })
    expect(second.exception.since).toEqual(expect.any(String))
    expect(second.exception.note).toContain('No agent repair')
  })

  it('offers return_to_build for a mechanical cause first, and nothing from the human gates', async () => {
    const other = await ticket('failed run', 'build', { runStatus: 'failed' })
    const review = await ticket('no mr', 'review', { run: false })
    await finding(other.id, 'run-failed')
    await finding(review.id, 'mr-missing')
    const orch = await connect('orchestrator')
    const r = await call('next_work', { sessionId: orch.sessionId })
    expect(r.exception.ticket.number).toBe(review.number)
    expect(r.exception.allowed).toEqual([{ tool: 'return_to_build', args: '{ticket, reason}' }])
    const { tools } = await import('../src/lib/mcp-tools')
    const human = tools.filter((t) => t.access === 'human').map((t) => t.name)
    expect(r.exception.allowed.map((a: Doc) => a.tool).filter((t: string) => human.includes(t))).toEqual([])
  })

  it('ignores a finding the sweep left stale, and a Ticket without one', async () => {
    const stale = await ticket('stale', 'review', { run: false })
    await ticket('unswept', 'build', { runStatus: 'failed' })
    await finding(stale.id, 'mr-missing', 20 * 60_000)
    const orch = await connect('orchestrator')
    const r = await call('next_work', { sessionId: orch.sessionId })
    expect(r.exception).toBeUndefined()
    expect(r.reason).toBe('Nothing queued for Orchestrator')
  })

  it('a role without the exceptions flag never receives one', async () => {
    const t = await ticket('no mr', 'review', { run: false })
    await finding(t.id, 'mr-missing')
    const eng = await connect('engineer')
    expect((await call('next_work', { sessionId: eng.sessionId })).exception).toBeUndefined()
  })
})

describe('presence and spans', () => {
  const claim = async () => {
    const t = await ticket('work', 'build')
    const eng = await connect('engineer', { model: 'claude-e' })
    const w = (await call('next_work', { sessionId: eng.sessionId })).work
    return { t, eng, w, session: await row(eng.sessionId) }
  }
  const spans = (sid: number) => rows(sql`SELECT * FROM "session_spans" WHERE "session_id" = ${sid} ORDER BY "started_at"`)

  it('claiming opens a span for the Run and finishing it closes the span with the Run attributed to the session', async () => {
    const { t, eng, w, session } = await claim()
    const [span] = await spans(session.id)
    expect(span).toMatchObject({ run_id: t.run!.id, ticket_id: t.id })
    await db().execute(sql`UPDATE "session_spans" SET "started_at" = now() - interval '5 minutes', "last_at" = now() - interval '4 minutes'`)
    await call('finish_run', { runId: t.run!.id, leaseToken: w.leaseToken, status: 'failed', reason: 'done for the test', sessionId: eng.sessionId })
    const [closed] = await spans(session.id)
    expect(closed.id).toBe(span.id)
    expect(Date.now() - new Date(closed.last_at).getTime()).toBeLessThan(5000)
    expect(await runRow(t.run!.id)).toMatchObject({ status: 'failed', role: 'engineer', model: 'claude-e', session_id: session.id })
  })

  it('touch writes lastSeenAt at most every 15 seconds', async () => {
    const { session } = await claim()
    await db().execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now() - interval '1 minute'`)
    await sessions.touch(payload, await row(session.publicId))
    const first = (await row(session.publicId)).lastSeenAt
    expect(Date.now() - new Date(first).getTime()).toBeLessThan(5000)
    await new Promise((r) => setTimeout(r, 30))
    await sessions.touch(payload, await row(session.publicId))
    expect((await row(session.publicId)).lastSeenAt).toBe(first)
  })

  it('a span is the whole time the session holds the Run: touches extend it, a long silence does not split it, active time counts it all', async () => {
    const { t, session } = await claim()
    const touch = async (force = false) => sessions.touch(payload, await row(session.publicId), { run: t.run!.id, force })
    await touch()
    expect(await spans(session.id)).toHaveLength(1)
    const before = (await spans(session.id))[0].last_at
    await touch()
    expect((await spans(session.id))[0].last_at).toEqual(before)
    await db().execute(sql`UPDATE "session_spans" SET "started_at" = now() - interval '25 minutes', "last_at" = now() - interval '25 minutes'`)
    await touch()
    const all = await spans(session.id)
    expect(all).toHaveLength(1)
    expect(new Date(all[0].last_at).getTime()).toBeGreaterThan(Date.now() - 5000)
    const s = (await sessions.loadTeam(payload, ws)).roles.find((r) => r.id === 'engineer')!.sessions[0]
    expect(s.activeSecondsTotal).toBeGreaterThan(1490)
    expect(s.activeSecondsTotal).toBeLessThan(1510)
    const window = await sessions.sessionTime(payload, ws, new Date(Date.now() - 20 * 60_000))
    expect(window.roles).toHaveLength(1)
    expect(window.roles[0].seconds).toBeGreaterThan(1190)
    expect(window.roles[0].seconds).toBeLessThan(1210)
    expect(window.sessions[0]).toMatchObject({ sessionId: session.publicId, role: 'engineer' })
  })

  it('disconnect ends the span of the Run it releases; a lapsed lease leaves the span at its last signal', async () => {
    const { t, eng, session } = await claim()
    await db().execute(sql`UPDATE "session_spans" SET "started_at" = now() - interval '30 minutes', "last_at" = now() - interval '20 minutes'`)
    await db().execute(sql`UPDATE "runs" SET "status" = 'abandoned' WHERE "id" = ${t.run!.id}`)
    await sessions.sweepSessions(payload)
    expect(Date.now() - new Date((await spans(session.id))[0].last_at).getTime()).toBeGreaterThan(19 * 60_000)
    await db().execute(sql`UPDATE "runs" SET "status" = 'running' WHERE "id" = ${t.run!.id}`)
    await call('disconnect', { sessionId: eng.sessionId })
    expect(Date.now() - new Date((await spans(session.id))[0].last_at).getTime()).toBeLessThan(5000)
  })

  it('a call on a Run the session does not hold opens no span', async () => {
    const { session } = await claim()
    const other = await ticket('other', 'build')
    await sessions.touch(payload, await row(session.publicId), { run: other.run!.id })
    expect(await spans(session.id)).toHaveLength(1)
  })
})

describe('sweepSessions', () => {
  it('times out a silent idle session, spares a recent one and one with a live Run', async () => {
    await ticket('live', 'build')
    const [silent, recent, busy] = [await connect('reviewer'), await connect('reviewer'), await connect('engineer')]
    await call('next_work', { sessionId: busy.sessionId })
    await db().execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now() - interval '11 minutes' WHERE "public_id" IN (${silent.sessionId}, ${busy.sessionId})`)
    expect(await sessions.sweepSessions(payload)).toBe(1)
    expect(await row(silent.sessionId)).toMatchObject({ endReason: 'timeout' })
    expect((await row(silent.sessionId)).disconnectedAt).toBeTruthy()
    expect((await row(recent.sessionId)).disconnectedAt).toBeNull()
    expect((await row(busy.sessionId)).disconnectedAt).toBeNull()
  })

  it('ends the session of a Run once its lease expired and the Run is abandoned', async () => {
    const t = await ticket('lapsed', 'build')
    const eng = await connect('engineer')
    await call('next_work', { sessionId: eng.sessionId })
    await db().execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now() - interval '11 minutes'`)
    expect(await sessions.sweepSessions(payload)).toBe(0)
    await db().execute(sql`UPDATE "runs" SET "status" = 'abandoned' WHERE "id" = ${t.run!.id}`)
    expect(await sessions.sweepSessions(payload)).toBe(1)
  })
})

describe('loadTeam', () => {
  it('reports working, idle and offline sessions per role, and the autonomous Runs working for a role', async () => {
    const t = await ticket('busy', 'build')
    await ticket('queued', 'build')
    const [working, idle, gone, stale] = [await connect('engineer', { label: 'w' }), await connect('engineer', { label: 'i' }), await connect('reviewer', { label: 'g' }), await connect('reviewer', { label: 's' })]
    await db().execute(sql`UPDATE "runs" SET "status" = 'queued', "mode" = 'session' WHERE "id" = ${t.run!.id}`)
    await call('next_work', { sessionId: working.sessionId })
    await call('disconnect', { sessionId: gone.sessionId })
    await db().execute(sql`UPDATE "agent_sessions" SET "last_seen_at" = now() - interval '11 minutes' WHERE "public_id" = ${stale.sessionId}`)
    const auto = await ticket('auto', 'plan', { run: 'plan', runStatus: 'running' })
    await db().execute(sql`UPDATE "runs" SET "mode" = 'autonomous', "executor" = 'runner', "started_at" = now() WHERE "id" = ${auto.run!.id}`)

    const team = await sessions.loadTeam(payload, ws)
    expect(team.roles.map((r) => r.id)).toEqual(['orchestrator', 'engineer', 'reviewer', 'security', 'ux', 'test'])
    const eng = team.roles.find((r) => r.id === 'engineer')!
    expect(eng).toMatchObject({ title: 'Software engineer', avatar: 'engineer', skills: ['Implementation', 'Small diffs', 'Tests first', 'Refactoring'], exceptions: false, tier: 'cheap', stages: [{ name: 'plan', title: 'Plan', kind: 'plan' }, { name: 'build', title: 'Build', kind: 'build' }] })
    expect(eng.profile).toContain('Mission:')
    expect(eng.sessions.map((s) => [s.label, s.status])).toEqual([['w', 'working'], ['i', 'idle']])
    expect(eng.sessions[0]).toMatchObject({ run: expect.any(Number), ticket: { number: expect.any(Number), title: expect.any(String), stage: 'build' }, publicId: working.sessionId })
    expect(eng.sessions[1].ticket).toBeUndefined()
    expect(eng.autonomous).toEqual([{ run: auto.run!.id, executor: 'runner', ticket: { number: auto.number, title: 'auto', stage: 'plan' }, startedAt: expect.any(String), model: null }])
    expect(team.roles.find((r) => r.id === 'reviewer')!.sessions.map((s) => [s.label, s.status])).toEqual([['g', 'offline'], ['s', 'offline']])
    expect(team.roles.find((r) => r.id === 'orchestrator')!.exceptions).toBe(true)
    expect(team.orphans).toEqual([])
    void idle
  })

  it('keeps disconnected sessions for 24 hours and lists sessions of a vanished role as orphans', async () => {
    const old = await connect('reviewer', { label: 'old' })
    const lost = await connect('reviewer', { label: 'lost' })
    await call('disconnect', { sessionId: old.sessionId })
    await call('disconnect', { sessionId: lost.sessionId })
    await db().execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now() - interval '25 hours' WHERE "public_id" = ${old.sessionId}`)
    await db().execute(sql`UPDATE "agent_sessions" SET "role" = 'ghost' WHERE "public_id" = ${lost.sessionId}`)
    const team = await sessions.loadTeam(payload, ws)
    expect(team.roles.find((r) => r.id === 'reviewer')!.sessions).toEqual([])
    expect(team.orphans.map((s) => [s.label, s.role])).toEqual([['lost', 'ghost']])
  })
})

it('the chat read tool team_status answers who works on what', async () => {
  const { chatTools, teamStatus } = await import('../src/lib/chat/tools')
  expect(chatTools({ role: 'admin' }).find((t) => t.name === 'team_status')).toMatchObject({ kind: 'read' })
  const t = await ticket('busy', 'build')
  const eng = await connect('engineer', { label: 'laptop', client: 'claude-code/2.1', model: 'm' })
  await connect('reviewer', { label: 'idle-one' })
  await call('next_work', { sessionId: eng.sessionId })
  const out = await teamStatus({ payload, user, actor: { kind: 'human' }, workspace: ws })
  const role = (title: string) => out.roles.find((r) => r.role === title)!
  expect(role('Software engineer').sessions).toEqual([{ session: 'laptop', status: 'working', ticket: `#${t.number} busy`, client: 'claude-code 2.1', model: 'm', activeMinutesToday: 0, activeMinutesTotal: 0 }])
  expect(role('Reviewer').sessions[0]).toMatchObject({ session: 'idle-one', status: 'idle', ticket: null })
  expect(role('Test specialist').sessions).toEqual([])
})

it('every agent tool but connect takes an optional sessionId', async () => {
  const { tools } = await import('../src/lib/mcp-tools')
  for (const t of tools.filter((x) => x.access === 'agent')) expect(Object.keys(t.inputSchema.properties).includes('sessionId'), t.name).toBe(t.name !== 'connect')
  expect(tools.find((t) => t.name === 'next_work')!.inputSchema.required).toEqual(['sessionId'])
})

it('the MCP server instructions name the roles and the loop', async () => {
  const text = sessions.instructions(factory.workflowFor(ws))
  expect(text).toContain('engineer: Software engineer')
  expect(text).toMatch(/connect first.*next_work.*sessionId.*finish_run.*disconnect/)
})
