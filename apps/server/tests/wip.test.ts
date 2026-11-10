import { sql } from '@payloadcms/db-postgres'
import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { wipLimitsError } from '../src/lib/wip-limits'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
let wip: typeof import('../src/lib/wip')
let loadOverview: typeof import('../src/app/(app)/lib/overview').loadOverview
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
let repo = ''
let connection: number
let n = 0

const usePack = (name?: 'gated-pack') => {
  if (name) process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  else delete process.env.BAUHERR_PACK_DIR
}
const limits = (wipLimits: Record<string, number> | null) => payload.update({ collection: 'workspaces', id: ws, data: { wipLimits }, ...o })

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('wip_253')
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
  release = await import('../src/lib/release')
  loadOverview = (await import('../src/app/(app)/lib/overview')).loadOverview
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
})

afterAll(async () => {
  usePack()
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  usePack()
  await limits({})
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'ticket_sources', where: { workspace: { equals: ws } }, ...o })
  repo = `acme/wip-${++n}`
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, ...o })).docs

const PLAN = '## Goal\n- Ship it\n\n## Steps\n1. Do it'
const SUBS = `${PLAN}\n\n## Sub-tickets\n- **Part A** — first.\n- **Part B** — second.\n`

/** An open Ticket in `stage`; a plan Ticket also gets a succeeded plan Run and a posted plan. */
const ticket = async (title: string, stage: string, extra: Record<string, unknown> = {}, markdown = PLAN) => {
  const labels = stage === 'triage' ? [] : [`bauherr:stage:${stage}`]
  const issue = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: stage === 'triage' ? null : stage, labels, product, workspace: ws, rank: title, ...extra }, ...o })
  if (stage === 'plan') {
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
    await actions.submitPlan(payload, user, { ticket: t.id as number, markdown })
  }
  return { id: t.id as number, n: String(issue.number) }
}

describe('Board data', () => {
  it('lists the sub-tickets of an epic by number, not by creation order', async () => {
    const epic = await ticket('epic', 'parent')
    for (const number of [30, 10, 20]) await ticket(`c${number}`, 'build', { parent: epic.id, number })
    const found = (await loadOverview(ws, false)).epics.find((e) => e.id === epic.id)!
    expect(found.children.map((c) => c.number)).toEqual([10, 20, 30])
  })
})

describe('the pull rule', () => {
  it('a third approved plan starts no Build Run while Build is full (gate off); a freed slot pulls it on the next poll', async () => {
    await limits({ build: 2 })
    const [a] = [await ticket('a', 'build'), await ticket('b', 'build')]
    const c = await ticket('c', 'plan')
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'plan', waitingFor: 'build' })
    expect(await runs(c.id, 'build')).toHaveLength(0)
    expect(await wip.waitingLabel(payload, await reload(c.id))).toBe('Waiting: Build is full (2/2)')
    await poll()
    expect((await fake.tickets(repo).listComments(c.n)).filter((x) => x.body.includes('Plan accepted automatically'))).toHaveLength(0)

    await payload.update({ collection: 'tickets', id: a.id, data: { stage: 'review' }, ...o })
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(c.id, 'build')).toHaveLength(1)
    expect((await fake.tickets(repo).get(c.n)).labels).toContain('bauherr:stage:build')
  })

  it('holds an approved plan with the gate on, with the label kept, and pulls it later', async () => {
    usePack('gated-pack')
    await limits({ build: 1 })
    await ticket('a', 'build')
    const c = await ticket('c', 'plan')
    await actions.approvePlan(payload, user, { ticket: c.id })
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'plan', waitingFor: 'build' })
    expect(await runs(c.id, 'build')).toHaveLength(0)
    expect((await fake.tickets(repo).get(c.n)).labels).toContain('bauherr:approved:plan')
    await limits({ build: 2 })
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(c.id, 'build')).toHaveLength(1)
  })

  it('pulls right to left and by rank inside a column', async () => {
    await limits({ plan: 1 })
    const a = await ticket('a', 'plan')
    await ticket('z', 'plan')
    await ticket('m', 'plan')
    await payload.update({ collection: 'tickets', id: a.id, data: { stage: 'build' }, ...o })
    await payload.update({ collection: 'tickets', where: { title: { in: ['z', 'm'] } }, data: { stage: 'triage', waitingFor: 'plan' }, ...o } as never)
    const waitingTitles = async () => (await payload.find({ collection: 'tickets', where: { waitingFor: { equals: 'plan' } }, ...o })).docs.map((t) => t.title)
    expect((await waitingTitles()).sort()).toEqual(['m', 'z'])
    await wip.pullWaiting(payload)
    expect(await waitingTitles()).toEqual(['z'])
  })

  it('never holds staging acceptance, the release watcher or a return from release, even into a full column', async () => {
    await limits({ build: 1, release: 1, review: 1 })
    await ticket('a', 'build')
    const full = await ticket('r1', 'release', { mergeSha: 'sha-1', releaseAt: new Date().toISOString(), releaseState: 'on_staging' })
    const second = await ticket('r2', 'release', { mergeSha: 'sha-2', releaseAt: new Date().toISOString(), releaseState: 'on_staging' })
    await actions.acceptStaging(payload, user, { ticket: second.id })
    expect(await reload(second.id)).toMatchObject({ stage: 'release', productionState: 'awaiting_approval' })
    await actions.requestChanges(payload, user, { ticket: full.id, note: 'again' })
    expect(await reload(full.id)).toMatchObject({ stage: 'build', waitingFor: null })
    expect(await runs(full.id, 'build')).toHaveLength(1)
    expect(await wip.wipCount(payload, ws, 'build')).toBe(2)
    expect(await release.watchRelease(payload)).toBeDefined()
  })

  it('holds a Build to Review move while Review is full and a hand-moved Ticket does not start a Review Run', async () => {
    await limits({ review: 1 })
    await ticket('a', 'review')
    const b = await ticket('b', 'build')
    expect(await actions.requestReview(payload, user, { ticket: b.id, evidence: '' })).toMatchObject({ stage: 'build', waiting: 'review' })
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: 'review' })
    expect(await jobs.startReviewIfReady(payload, { ...(await reload(b.id)), stage: 'review' })).toBeNull()
    await payload.update({ collection: 'tickets', where: { title: { equals: 'a' } }, data: { stage: 'release' }, ...o } as never)
    await wip.pullWaiting(payload)
    expect(await reload(b.id)).toMatchObject({ stage: 'review', waitingFor: null })
  })

  it('Triage holds a Ticket for a full Plan column without a Run', async () => {
    await limits({ plan: 1 })
    await ticket('a', 'plan')
    const t = await ticket('t', 'triage')
    const outcome = { outcome: 'plan' as const, reason: 'clear', questions: [] }
    expect(await actions.submitTriage(payload, t.id, outcome)).toEqual({ outcome: 'plan' })
    expect(await reload(t.id)).toMatchObject({ waitingFor: 'plan' })
    expect((await fake.tickets(repo).get(t.n)).labels).not.toContain('bauherr:stage:plan')
    await poll()
    expect(await runs(t.id, 'triage')).toHaveLength(0)
  })
})

describe('counting and workspaces', () => {
  it('a Build Ticket waiting for a full Review still counts in Build, so no new Build Run starts', async () => {
    await limits({ build: 2, review: 1 })
    await ticket('r', 'review')
    for (const title of ['a', 'b']) await ticket(title, 'build', { waitingFor: 'review' })
    const c = await ticket('c', 'plan')
    expect(await wip.wipCount(payload, ws, 'build')).toBe(2)
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'plan', waitingFor: 'build' })
    expect(await runs(c.id, 'build')).toHaveLength(0)
    expect(await wip.waitingLabel(payload, await reload(c.id))).toBe('Waiting: Build is full (2/2)')
    expect(await wip.wipCount(payload, ws, 'plan')).toBe(1)
  })

  it('counts the Release column too (Settings > Board & WIP shows it)', async () => {
    await ticket('rel', 'release')
    expect(await wip.wipCount(payload, ws, 'release')).toBe(1)
  })

  it('pulls per Workspace: a full column in one Workspace does not stop pulls in another', async () => {
    const other = (await payload.create({ collection: 'workspaces', data: { name: 'beta', slug: 'beta', wipLimits: { build: 2 } }, ...o })).id as number
    const otherProduct = (await payload.create({ collection: 'products', data: { name: 'api', slug: 'api', workspace: other }, ...o })).id as number
    const otherConnection = (await payload.create({ collection: 'connections', data: { name: 'gh2', kind: 'github', workspace: other }, ...o })).id as number
    const otherRepo = `beta/wip-${n}`
    await payload.create({ collection: 'ticket_sources', data: { repo: otherRepo, product: otherProduct, connection: otherConnection, workspace: other }, ...o })
    await limits({ build: 2 })
    await ticket('x', 'build')
    await ticket('y', 'build')
    const a1 = await ticket('a1', 'plan', { waitingFor: 'build' })
    const issue = await fake.tickets(otherRepo).create({ title: 'b1', labels: ['bauherr:stage:plan'] })
    const b1 = await payload.create({ collection: 'tickets', data: { title: 'b1', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product: otherProduct, workspace: other, rank: 'b1', waitingFor: 'build' }, ...o })
    await wip.pullWaiting(payload)
    expect(await reload(a1.id)).toMatchObject({ stage: 'plan', waitingFor: 'build' })
    expect(await reload(b1.id as number)).toMatchObject({ stage: 'build', waitingFor: null })
    await payload.delete({ collection: 'runs', where: { workspace: { equals: other } }, ...o })
    await payload.delete({ collection: 'tickets', where: { workspace: { equals: other } }, ...o })
  })
})

describe('sub-tickets and parents', () => {
  it('children over the limit wait in Plan for Build without a Run and are not counted; parents are not counted', async () => {
    await limits({ build: 1 })
    const p = await ticket('p', 'plan', {}, SUBS)
    await poll()
    expect(await reload(p.id)).toMatchObject({ stage: 'parent' })
    const kids = (await payload.find({ collection: 'tickets', where: { parent: { equals: p.id } }, sort: 'number', ...o })).docs as { id: number; stage: string; waitingFor?: string | null }[]
    expect(kids.map((k) => [k.stage, k.waitingFor ?? null])).toEqual([['build', null], ['plan', 'build']])
    await poll()
    expect(await runs(kids[0].id, 'build')).toHaveLength(1)
    expect(await runs(kids[1].id, 'build')).toHaveLength(0)
    expect(await wip.wipCount(payload, ws, 'build')).toBe(1)
    await payload.update({ collection: 'tickets', id: kids[0].id, data: { stage: 'review' }, ...o })
    await poll()
    expect(await runs(kids[1].id, 'build')).toHaveLength(1)
    expect(await reload(kids[1].id)).toMatchObject({ stage: 'build', waitingFor: null })
  })
})

describe('Board counts and waiting display', () => {
  it('the Board header count is wipCount', async () => {
    await limits({ build: 5 })
    const blocker = await ticket('blocker', 'review')
    await ticket('running', 'build')
    await ticket('blocked', 'build', { blockedBy: [blocker.id] })
    await ticket('waiting', 'plan', { waitingFor: 'build' })
    await ticket('done', 'build', { state: 'closed' })
    await ticket('parent', 'parent')
    const other = (await payload.create({ collection: 'products', data: { name: 'other', slug: `other-${n}`, workspace: ws }, ...o })).id as number
    await payload.create({ collection: 'tickets', data: { title: 'o', externalId: 'o', number: 999, state: 'open', stage: 'build', labels: [], product: other, workspace: ws, rank: 'o' }, ...o })
    const { wip: board } = await loadOverview(ws, false)
    const expected = { plan: await wip.wipCount(payload, ws, 'plan'), build: await wip.wipCount(payload, ws, 'build'), review: await wip.wipCount(payload, ws, 'review'), release: await wip.wipCount(payload, ws, 'release') }
    for (const s of ['plan', 'build', 'review', 'release'] as const) expect(board[s].count).toBe(expected[s])
    expect(await wip.wipCounts(payload, ws)).toEqual(expected)
    expect(expected.build).toBe(3)
  })

  it('a blocked Ticket shows its blocker, not a capacity message', async () => {
    await limits({ build: 1 })
    await ticket('x', 'build')
    const blocker = await ticket('blocker', 'review')
    const b = await ticket('b', 'plan', { waitingFor: 'build', blockedBy: [blocker.id] })
    const row = async () => (await loadOverview(ws, false)).tickets.find((r) => r.id === b.id)!
    expect(await row()).toMatchObject({ waiting: null, blockedBy: [{ id: blocker.id }] })
    await payload.update({ collection: 'tickets', id: blocker.id, data: { state: 'closed' }, ...o })
    expect(await row()).toMatchObject({ waiting: 'Queued for Build: Build is full (1/1). Starts by itself.', blockedBy: [] })
  })

  it('never stores waitingFor equal to stage, except an overlap hold that carries its reason', async () => {
    const t = await ticket('t', 'plan', { waitingFor: 'build' })
    await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'build', waitingFor: 'build' }, ...o })
    expect(await reload(t.id)).toMatchObject({ stage: 'build', waitingFor: null })
    const u = await ticket('u', 'plan', { waitingFor: 'build' })
    await payload.update({ collection: 'tickets', id: u.id, data: { stage: 'build' }, ...o })
    expect(await reload(u.id)).toMatchObject({ waitingFor: null })
    const held = await ticket('h', 'plan')
    await payload.update({ collection: 'tickets', id: held.id, data: { stage: 'build', waitingFor: 'build', waitingReason: 'overlaps #1' }, ...o })
    expect(await reload(held.id)).toMatchObject({ stage: 'build', waitingFor: 'build', waitingReason: 'overlaps #1' })
    const db = payload.db.drizzle
    await db.execute(sql`UPDATE "tickets" SET "waiting_for" = 'build', "waiting_reason" = NULL WHERE "id" = ${t.id}`)
    expect((await reload(t.id)).waitingFor).toBe('build')
    await (await import('../src/migrations/20261104_170000_clear_self_waiting')).up({ db } as never)
    expect((await reload(t.id)).waitingFor).toBeNull()
    expect(await reload(held.id)).toMatchObject({ waitingFor: 'build', waitingReason: 'overlaps #1' })
  })
})

describe('limits', () => {
  it('a raised or removed limit releases a waiting Ticket on the next poll; no limit means no hold', async () => {
    await limits({ build: 1 })
    await ticket('a', 'build')
    const b = await ticket('b', 'plan')
    await poll()
    expect((await reload(b.id)).waitingFor).toBe('build')
    await limits({ build: 2 })
    await poll()
    expect(await reload(b.id)).toMatchObject({ stage: 'build', waitingFor: null })
    await limits(null)
    const c = await ticket('c', 'plan')
    await poll()
    expect(await reload(c.id)).toMatchObject({ stage: 'build', waitingFor: null })
  })

  it('two concurrent entries into one free slot: exactly one moves', async () => {
    await limits({ build: 1 })
    const [a, b] = [await ticket('a', 'plan'), await ticket('b', 'plan')]
    const enter = async (t: { id: number }) =>
      wip.enterStage(payload, await reload(t.id), 'build', async () => {
        await new Promise((r) => setTimeout(r, 50))
        await payload.update({ collection: 'tickets', id: t.id, data: { stage: 'build' }, ...o })
      })
    expect((await Promise.all([enter(a), enter(b)])).sort()).toEqual(['moved', 'waiting'])
  })

  it('validates limits: whole numbers of at least 1 for the four columns', () => {
    expect(wipLimitsError({ plan: 3, build: 2, review: 3, release: 5 })).toBeNull()
    expect(wipLimitsError({})).toBeNull()
    expect(wipLimitsError({ build: 0 })).toMatch(/build/)
    expect(wipLimitsError({ build: 1.5 })).toMatch(/build/)
    expect(wipLimitsError({ triage: 1 })).toMatch(/unknown/)
    expect(wipLimitsError([1])).toMatch(/object/)
  })

  it('new Workspaces start with the default limits; only an Admin may change them', async () => {
    const w = await payload.create({ collection: 'workspaces', data: { name: 'new', slug: 'new' }, ...o })
    expect(w.wipLimits).toEqual({ plan: 3, build: 2, review: 3, release: 5 })
    const member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: w.id }] }, ...o })
    await payload.update({ collection: 'workspaces', id: w.id, data: { wipLimits: { build: 9 } }, user: member, overrideAccess: false })
    expect((await payload.findByID({ collection: 'workspaces', id: w.id, ...o })).wipLimits).toEqual({ plan: 3, build: 2, review: 3, release: 5 })
    await expect(payload.update({ collection: 'workspaces', id: w.id, data: { wipLimits: { build: 0 } }, ...o })).rejects.toThrow()
  })

  it('the migration sets the defaults on existing Workspaces', async () => {
    const db = payload.db.drizzle
    await db.execute(sql`ALTER TABLE "tickets" DROP COLUMN "waiting_for"; ALTER TABLE "workspaces" DROP COLUMN "wip_limits"; DROP TYPE IF EXISTS "public"."enum_tickets_waiting_for"`)
    await (await import('../src/migrations/20261103_180000_wip_limits')).up({ db } as never)
    const rows = (await db.execute(sql`SELECT "wip_limits" AS w FROM "workspaces"`)).rows
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows) expect(r.w).toEqual({ plan: 3, build: 2, review: 3, release: 5 })
    await db.execute(sql`SELECT "waiting_for" FROM "tickets" LIMIT 1`)
  })
})
