import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PLAN_MARKER } from '../src/app/(app)/lib/plan'
import { EXPEDITE_LABEL, EXPEDITE_PROPOSED, needsYou } from '../src/lib/needs-you'
import { DEFAULT } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
let wip: typeof import('../src/lib/wip')
let overlap: typeof import('../src/lib/overlap')
const o = { overrideAccess: true } as const
let repo = ''
let connection: number
let n = 0

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('expedite_371')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  wip = await import('../src/lib/wip')
  overlap = await import('../src/lib/overlap')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'maria' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: {}, expediteLane: true }, ...o })
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'ticket_sources', where: { workspace: { equals: ws } }, ...o })
  repo = `acme/exp-${++n}`
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const byNumber = async (number: number) => (await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: ws } }, { number: { equals: number } }] }, limit: 1, ...o })).docs[0] as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, ...o })).docs
const comments = async (number: number) => (await fake.tickets(repo).listComments(String(number))).map((c) => c.body)
const labelsOf = async (number: number) => (await fake.tickets(repo).get(String(number))).labels

const BODY_WITH_PLAN = '## Problem\nProduction is down.\n\n## Plan\n1. Revert the change.'
/** An issue whose labels were set by `actor` (the Admin 'maria' unless a test says otherwise). */
const issue = async (title: string, body = '', labels: string[] = [EXPEDITE_LABEL], actor = 'maria') => {
  fake.actingAs = actor
  try {
    return await fake.tickets(repo).create({ title, body, labels })
  } finally {
    fake.actingAs = 'factory'
  }
}

/** An open Ticket in `stage` with a plan declaring `files`, as in the overlap tests. */
const inBuild = async (title: string, files: string[], extra: Record<string, unknown> = {}) => {
  const labels = ['bauherr:stage:build']
  const i = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(i.number), number: i.number, url: i.url, state: 'open', stage: 'build', labels, product, workspace: ws, rank: title, ...extra }, ...o })
  await fake.tickets(repo).comment(String(i.number), `${PLAN_MARKER}\n## Goal\n- x\n\n## Steps\n1. y\n\n## Files\n${files.map((f) => `- ${f}`).join('\n')}`)
  return { id: t.id as number, n: i.number }
}

describe('entry', () => {
  it('a labelled Ticket skips Triage and enters Plan with a Run', async () => {
    const i = await issue('prod down')
    await poll()
    const t = await byNumber(i.number)
    expect(t).toMatchObject({ expedite: true, stage: 'plan' })
    expect(await runs(t.id, 'triage')).toHaveLength(0)
    expect(await runs(t.id, 'plan')).toHaveLength(1)
    expect(await labelsOf(i.number)).toContain('bauherr:stage:plan')
  })

  it('a Ticket with a plan in its body enters Build', async () => {
    const i = await issue('prod down', BODY_WITH_PLAN)
    await poll()
    const t = await byNumber(i.number)
    expect(t).toMatchObject({ expedite: true, stage: 'build' })
    expect(await runs(t.id, 'build')).toHaveLength(1)
    expect(await labelsOf(i.number)).toContain('bauherr:stage:build')
  })

  it('a full Build column still takes it and does not count it', async () => {
    await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: { build: 1 } }, ...o })
    await inBuild('a', ['src/a.ts'])
    const i = await issue('prod down', BODY_WITH_PLAN)
    await poll()
    const t = await byNumber(i.number)
    expect(t).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(t.id, 'build')).toHaveLength(1)
    expect(await wip.wipCount(payload, ws, 'build')).toBe(1)
  })

  it('an expedite Ticket skips the plan gate: the succeeded plan moves on to Build', async () => {
    const { fileURLToPath } = await import('node:url')
    process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
    const i = await issue('prod down')
    await poll()
    const t = await byNumber(i.number)
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
    await actions.submitPlan(payload, user, { ticket: t.id, markdown: '## Goal\n- x\n\n## Steps\n1. y' })
    await poll()
    expect(await reload(t.id)).toMatchObject({ stage: 'build' })
    expect(needsYou(DEFAULT(), { stage: 'plan', labels: [], expedite: true }, { stage: 'plan', status: 'succeeded' }, 0, ['plan'])).toBeNull()
    expect(needsYou(DEFAULT(), { stage: 'plan', labels: [], expedite: false }, { stage: 'plan', status: 'succeeded' }, 0, ['plan'])).toBe('Approve plan')
  })
})

describe('bypasses', () => {
  it('the overlap hold never holds an expedite Build, and later Tickets wait for it', async () => {
    const early = await inBuild('a', ['src/app/**'])
    const hot = await inBuild('z', ['src/app/page.tsx'], { expedite: true })
    await payload.create({ collection: 'runs', data: { ticket: hot.id, stage: 'build', status: 'running', mode: 'autonomous', workspace: ws }, ...o })
    expect(await overlap.holdOverlap(payload, await reload(hot.id))).toBe(false)
    expect((await reload(hot.id)).waitingFor).toBeFalsy()
    // a lower rank than `hot`, yet it waits for it
    const later = await inBuild('b', ['src/app/page.tsx'])
    await payload.update({ collection: 'tickets', id: early.id, data: { stage: 'release' }, ...o })
    expect(await overlap.holdOverlap(payload, await reload(later.id))).toBe(true)
    expect(await reload(later.id)).toMatchObject({ waitingFor: 'build', waitingReason: `overlaps #${hot.n}` })
  })
})

describe('one at a time', () => {
  it('a second expedite waits with a Comment and enters when the first is done', async () => {
    const first = await issue('first')
    const second = await issue('second')
    await poll()
    const [a, b] = [await byNumber(first.number), await byNumber(second.number)]
    expect(a).toMatchObject({ stage: 'plan', expedite: true })
    expect(b.stage ?? null).toBeNull()
    expect(await runs(b.id, 'plan')).toHaveLength(0)
    expect(await runs(b.id, 'triage')).toHaveLength(0)
    expect((await comments(second.number)).some((c) => c.includes('another expedite Ticket is in flight'))).toBe(true)
    await poll()
    expect((await comments(second.number)).filter((c) => c.includes('another expedite Ticket is in flight'))).toHaveLength(1)

    await payload.update({ collection: 'tickets', id: a.id, data: { state: 'closed' }, ...o })
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'plan', expedite: true })
    expect(await runs(b.id, 'plan')).toHaveLength(1)
  })

  it('a queued expedite Ticket keeps its Triage Run and names the fast-lane holder', async () => {
    const { fastLaneHolder } = await import('../src/lib/expedite')
    const holder = await inBuild('holder', ['src/a.ts'], { expedite: true })
    fake.actingAs = 'maria'
    await fake.tickets(repo).addLabels(String(holder.n), [EXPEDITE_LABEL])
    fake.actingAs = 'factory'
    const second = await issue('second', '', [])
    await poll()
    fake.actingAs = 'maria'
    await fake.tickets(repo).addLabels(String(second.number), [EXPEDITE_LABEL])
    fake.actingAs = 'factory'
    await poll()
    const b = await byNumber(second.number)
    expect(b.stage ?? null).toBeNull()
    expect((await runs(b.id, 'triage')).map((r) => r.status)).toEqual(['queued'])
    expect(await fastLaneHolder(payload, b)).toBe(holder.n)
    expect(await fastLaneHolder(payload, await reload(holder.id))).toBeNull()
    const { loadOverviewRows } = await import('../src/app/(app)/lib/overview')
    expect((await loadOverviewRows(ws, false)).tickets.find((t) => t.number === second.number)?.queuedWhy).toBe(`Waiting for the fast lane: #${holder.n}`)
  })

  it('Settings > Factory > Workflow off: the label is ignored with a Comment and Triage runs', async () => {
    await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
    const i = await issue('prod down')
    await poll()
    const t = await byNumber(i.number)
    expect(t.expedite).toBe(false)
    expect(t.stage ?? null).toBeNull()
    expect(await runs(t.id, 'triage')).toHaveLength(1)
    await poll()
    expect((await comments(i.number)).filter((c) => c.includes('Expedite lane is off'))).toHaveLength(1)
    await expect(actions.expedite(payload, user, { ticket: t.id })).rejects.toThrow('lane is off')
  })

  it('removing the label returns a waiting Ticket to the normal flow', async () => {
    await issue('first')
    const second = await issue('second')
    await poll()
    const b = await byNumber(second.number)
    expect(await runs(b.id, 'triage')).toHaveLength(0)
    await fake.tickets(repo).removeLabels(String(second.number), [EXPEDITE_LABEL])
    await poll()
    expect(await reload(b.id)).toMatchObject({ expedite: false })
    expect(await runs(b.id, 'triage')).toHaveLength(1)
  })
})

describe('a parked holder yields the slot', () => {
  const YIELDED = 'gave its fast-lane place to'
  const start = async () => (await import('../src/lib/expedite')).startExpedites(payload)
  /** A flagged Ticket without a stage, as the poller leaves it while the slot is taken. */
  const waitingTicket = async (title: string) => {
    const i = await fake.tickets(repo).create({ title, labels: [EXPEDITE_LABEL] })
    const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(i.number), number: i.number, url: i.url, state: 'open', labels: [EXPEDITE_LABEL], expedite: true, product, workspace: ws, rank: title }, ...o })
    return { id: t.id as number, n: i.number }
  }
  const run = (ticket: number, status: string) => payload.create({ collection: 'runs', data: { ticket, stage: 'build', status, mode: 'autonomous', workspace: ws }, ...o })

  it('a waiting Ticket takes the slot of a parked holder, which keeps the flag and gets one Comment', async () => {
    const holder = await inBuild('holder', ['src/a.ts'], { expedite: true, needsYou: 'Approve plan' })
    const hot = await waitingTicket('hot')
    await start()
    await start()
    expect(await reload(hot.id)).toMatchObject({ stage: 'plan', expedite: true })
    expect(await reload(holder.id)).toMatchObject({ expedite: true, expediteYieldedTo: hot.id })
    expect((await comments(holder.n)).filter((c) => c.includes(YIELDED) && c.includes(`#${hot.n}`))).toHaveLength(1)
  })

  it('a parked holder alone is unchanged', async () => {
    const holder = await inBuild('holder', ['src/a.ts'], { expedite: true, needsYou: 'Approve plan' })
    await start()
    expect((await reload(holder.id)).expediteYieldedTo ?? null).toBeNull()
    expect((await comments(holder.n)).some((c) => c.includes(YIELDED))).toBe(false)
  })

  it('a running holder keeps the slot: the waiting Ticket queues', async () => {
    const holder = await inBuild('holder', ['src/a.ts'], { expedite: true, needsYou: 'Run needs you' })
    await run(holder.id, 'running')
    const hot = await waitingTicket('hot')
    await start()
    expect((await reload(hot.id)).stage ?? null).toBeNull()
    expect((await reload(holder.id)).expediteYieldedTo ?? null).toBeNull()
    expect((await comments(hot.n)).some((c) => c.includes('another expedite Ticket is in flight'))).toBe(true)
  })

  it('an unparked yielded holder takes the place back when it is free', async () => {
    const { isExpediting } = await import('../src/lib/expedite')
    const hot = await inBuild('hot', ['src/b.ts'], { expedite: true })
    const holder = await inBuild('holder', ['src/a.ts'], { expedite: true, expediteYieldedTo: hot.id })
    expect(await isExpediting(payload, await reload(holder.id))).toBe(false)
    await payload.update({ collection: 'tickets', id: hot.id, data: { state: 'closed' }, ...o })
    await start()
    expect((await reload(holder.id)).expediteYieldedTo ?? null).toBeNull()
    expect(await isExpediting(payload, await reload(holder.id))).toBe(true)
  })

  it('an unparked yielded holder stays yielded while the new holder is in flight', async () => {
    const hot = await inBuild('hot', ['src/b.ts'], { expedite: true })
    const holder = await inBuild('holder', ['src/a.ts'], { expedite: true, expediteYieldedTo: hot.id })
    await start()
    expect((await reload(holder.id)).expediteYieldedTo).toBe(hot.id)
  })
})

describe('Triage proposal', () => {
  it('is normalised, shown as the needs-you "Expedite?" and never applied by itself; the action applies it', async () => {
    const i = await fake.tickets(repo).create({ title: 'bug', labels: [] })
    await poll()
    const t = await byNumber(i.number)
    const triage = actions.normalizeTriage({ outcome: 'plan', reason: 'prod down', expedite: true })
    expect(triage.expedite).toBe(true)
    expect(actions.normalizeTriage({ outcome: 'plan', reason: 'ok' }).expedite).toBeUndefined()
    await actions.submitTriage(payload, t.id, triage)
    await poll()
    const proposed = await reload(t.id)
    expect(proposed).toMatchObject({ expedite: false, stage: 'plan' })
    expect(await labelsOf(i.number)).not.toContain(EXPEDITE_LABEL)
    expect(await labelsOf(i.number)).toContain(EXPEDITE_PROPOSED)
    expect(needsYou(DEFAULT(), { stage: proposed.stage, labels: proposed.labels, expedite: proposed.expedite }, null)).toBe('Expedite?')

    await actions.expedite(payload, user, { ticket: t.id })
    expect(await labelsOf(i.number)).toContain(EXPEDITE_LABEL)
    expect(await labelsOf(i.number)).not.toContain(EXPEDITE_PROPOSED)
    await poll()
    const done = await reload(t.id)
    expect(done.expedite).toBe(true)
    expect(needsYou(DEFAULT(), { stage: done.stage, labels: done.labels, expedite: done.expedite }, null)).toBeNull()
  })

  it('a label set by someone who is not a gate owner or Admin is stripped and the Ticket goes through Triage', async () => {
    const i = await issue('prod down', BODY_WITH_PLAN, [EXPEDITE_LABEL], 'stranger')
    await poll()
    const t = await byNumber(i.number)
    expect(t.expedite).toBe(false)
    expect(t.stage).not.toBe('build')
    expect(await labelsOf(i.number)).not.toContain(EXPEDITE_LABEL)
    expect((await comments(i.number)).some((c) => c.includes('Bauherr removed `bauherr:expedite`'))).toBe(true)
  })

  it('an unclaimed Triage Run is cancelled on entry; one being worked on makes the Ticket wait', async () => {
    const i = await issue('prod down', '', [])
    await poll()
    const t = await byNumber(i.number)
    const triage = await runs(t.id, 'triage')
    expect(triage).toHaveLength(1)
    fake.actingAs = 'maria'
    await fake.tickets(repo).addLabels(String(i.number), [EXPEDITE_LABEL])
    fake.actingAs = 'factory'
    await payload.update({ collection: 'runs', id: triage[0]!.id, data: { status: 'running' }, ...o })
    await poll()
    expect((await reload(t.id)).stage).not.toBe('plan')
    await payload.update({ collection: 'runs', id: triage[0]!.id, data: { status: 'awaiting_session' }, ...o })
    await poll()
    expect((await payload.findByID({ collection: 'runs', id: triage[0]!.id, ...o })).status).toBe('cancelled')
    expect((await reload(t.id)).stage).toBe('plan')
  })

  it('only an Admin can use the Expedite action', async () => {
    const member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
    const t = await inBuild('plain', ['src/a.ts'])
    await expect(actions.expedite(payload, member, { ticket: t.id })).rejects.toThrow('Only an Admin')
    expect(await labelsOf(t.n)).not.toContain(EXPEDITE_LABEL)
  })

  it('turning the lane off drops the flag of a Ticket already in flight', async () => {
    const t = await inBuild('flagged', ['src/a.ts'], { expedite: true })
    expect((await reload(t.id)).expedite).toBe(true)
    await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
    await (await import('../src/lib/expedite')).startExpedites(payload)
    expect((await reload(t.id)).expedite).toBe(false)
  })

  it('a second Ticket flagged while another is in flight gets no bypass', async () => {
    const { isExpediting } = await import('../src/lib/expedite')
    const first = await inBuild('first', ['src/a.ts'], { expedite: true })
    const second = await inBuild('second', ['src/b.ts'], { expedite: true })
    expect(await isExpediting(payload, await reload(first.id))).toBe(true)
    expect(await isExpediting(payload, await reload(second.id))).toBe(false)
  })
})

describe('pull order', () => {
  it('claim_next returns the expedite Run before older Builds and Reviews; heartbeat names it', async () => {
    const { callTool } = await import('../src/lib/mcp-tools')
    const agent = await payload.create({ collection: 'bauherren', data: { email: `s${++n}@x.io`, password: 'pw-123456', role: 'admin' }, ...o })
    const call = (name: string, input: unknown) => callTool({ payload, user: agent, actor: { kind: 'human' } }, name, input) as Promise<any>
    const awaiting = (ticket: number, stage: string) => payload.create({ collection: 'runs', data: { ticket, stage, mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
    const mine = await inBuild('c', ['src/c.ts'])
    const myRun = await awaiting(mine.id, 'build')
    const { leaseToken } = await call('claim_run', { runId: myRun.id })
    const old = await inBuild('a', ['src/a.ts'])
    await awaiting(old.id, 'build')
    const rev = await inBuild('b', ['src/b.ts'], { stage: 'review' })
    await awaiting(rev.id, 'review')
    expect((await call('heartbeat', { runId: myRun.id, leaseToken })).expedite).toBeUndefined()

    const i = await issue('prod down', BODY_WITH_PLAN)
    await poll()
    const hot = await byNumber(i.number)
    const hotRun = (await runs(hot.id, 'build'))[0]
    await payload.update({ collection: 'runs', id: hotRun.id, data: { mode: 'session', status: 'awaiting_session' }, ...o })

    const frontier = await call('list_frontier', {})
    expect(frontier[0]).toMatchObject({ ticket: hot.id, claimable: true })
    expect((await call('heartbeat', { runId: myRun.id, leaseToken })).expedite).toEqual({ ticket: hot.id, run: hotRun.id })
    expect((await call('claim_next', {})).run.id).toBe(hotRun.id)
  })

  it('an expedite Ticket outside the lane (lane off) gets no priority', async () => {
    const { frontierOrder } = await import('../src/lib/frontier')
    const t = (id: number, extra = {}) => ({ id, number: id, stage: 'build', rank: String(id), ...extra })
    expect(frontierOrder([t(1), t(2, { stage: 'plan', expediting: true })], new Map()).map((x) => x.id)).toEqual([2, 1])
    expect(frontierOrder([t(1), t(2, { stage: 'plan', expediting: false })], new Map()).map((x) => x.id)).toEqual([1, 2])
  })
})
