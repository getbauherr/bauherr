import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let ws: number
let product: number
let connection: number
let fake: FakeBackend
let testDb: TestDb
let trust: typeof import('../src/lib/trust')
let insights: typeof import('../src/app/(app)/lib/insights')
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
const o = { overrideAccess: true, depth: 0 } as const
const DAY = 864e5
let A: number
let B: number

beforeAll(async () => {
  testDb = await createTestDb('trust')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  trust = await import('../src/lib/trust')
  insights = await import('../src/app/(app)/lib/insights')
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', stagingUrl: 'https://s.example', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/trust', product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const done = async (n: number, data: Record<string, unknown>, closedDaysAgo = 0) => {
  const t = (await payload.create({ collection: 'tickets', data: { title: `t${n}`, externalId: `e${n}`, number: n, state: 'closed', stage: 'done', labels: [], product, workspace: ws, ...data } as never, ...o })).id as number
  await event(t, { phase: 'closed', stage: 'done', cause: 'run:finished', executor: 'factory' }, closedDaysAgo)
  return t
}
const event = (ticket: number, data: Record<string, unknown>, daysAgo = 0) => payload.create({ collection: 'ticket_events', data: { ticket, workspace: ws, at: new Date(Date.now() - daysAgo * DAY).toISOString(), ...data } as never, ...o })
const run = (ticket: number, data: Record<string, unknown>) => payload.create({ collection: 'runs', data: { ticket, workspace: ws, product, stage: 'build', kind: 'build', status: 'succeeded', ...data } as never, ...o })

describe('gradeOf', () => {
  it('drops one step per failing group, ignores unknown ones and stops at D', () => {
    const g = (...p: (boolean | null)[]) => trust.gradeOf(p.map((pass) => ({ pass })))
    expect(g(true, true, true, true)).toBe('A')
    expect(g(true, null, true, null)).toBe('A')
    expect(g(false, true, true, true)).toBe('B')
    expect(g(false, false, true, null)).toBe('C')
    expect(g(false, false, false, false)).toBe('D')
  })

  it('a group fails on any failing line, passes on a passing one, else is unknown', () => {
    expect(trust.passOf([{ pass: true }, { pass: false }])).toBe(false)
    expect(trust.passOf([{ pass: null }, { pass: true }])).toBe(true)
    expect(trust.passOf([{ pass: null }])).toBeNull()
    expect(trust.passOf([])).toBeNull()
  })

  it('counts a human act outside the planned gates as an intervention, not the wait or a planned gate', () => {
    const i = trust.isIntervention
    expect(i({ executor: 'human', phase: 'queued', cause: 'sendBack' })).toBe(true)
    expect(i({ executor: 'human', phase: 'queued', cause: 'gate:review-cap:grant' })).toBe(true)
    expect(i({ executor: 'human', phase: 'queued', cause: 'gate:approve:plan' })).toBe(false)
    expect(i({ executor: 'human', phase: 'queued', cause: 'gate:accept:staging' })).toBe(false)
    expect(i({ executor: 'human', phase: 'human', cause: 'sweep' })).toBe(false)
    expect(i({ executor: 'factory', phase: 'queued', cause: 'sendBack' })).toBe(false)
  })

  it('recommends relying on proof only with history, no escaped defect and little rework', () => {
    expect(trust.earnedAutonomy({ done: 12, escaped: 0, reworkRate: 0.04 }, 30)).toMatchObject({ met: true, text: 'Review could rely on proof: 0 escaped defects and under 5 % rework over 4 weeks' })
    expect(trust.earnedAutonomy({ done: 12, escaped: 1, reworkRate: 0.04 }, 30).met).toBe(false)
    expect(trust.earnedAutonomy({ done: 12, escaped: 0, reworkRate: 0.2 }, 30).met).toBe(false)
    expect(trust.earnedAutonomy({ done: 3, escaped: 0, reworkRate: 0 }, 30).met).toBe(false)
    expect(trust.earnedAutonomy({ done: 12, escaped: 0, reworkRate: 0 }, 7).met).toBe(false)
  })
})

describe('ticketTrust', () => {
  beforeAll(async () => {
    A = await done(1, { labels: ['bauherr:approved:staging'], approvalBrief: { sha: 'x', changes: [], notIncluded: [], risk: '', proof: null, noted: [], checks: { ci: 'CI: 5 of 5 checks passed', testsAdded: 1, noProof: [] }, links: [] } })
    await payload.create({ collection: 'artifacts', data: { ticket: A, kind: 'report', title: 'Test report', text: 'ok', sha: 'abc', workspace: ws } as never, ...o })
    await run(A, { costEstimateUsd: 4 })
    await run(A, { stage: 'review', kind: 'review', verdict: 'changes', findings: [{ severity: 'high', class: 'correctness', file: 'a.ts', line: 1, msg: 'm', scenario: 's' }, { severity: 'low', class: 'low', file: 'a.ts', line: 2, msg: 'm', scenario: 's' }] })
    await run(A, { stage: 'review', kind: 'review', verdict: 'clean' })
    await event(A, { phase: 'queued', stage: 'plan', cause: 'gate:approve:plan', executor: 'human' })
    await event(A, { phase: 'queued', stage: 'build', fromStage: 'review', cause: 'sendBack', executor: 'human' })
    await event(A, { phase: 'human', stage: 'review', cause: 'sweep', executor: 'human' })
    B = await done(2, { labels: ['bauherr:approved:staging'] })
    await run(B, { costEstimateUsd: 1 })
    const c = await done(3, {}, 40)
    await run(c, { costEstimateUsd: 3 })
  })

  it('groups the evidence, counts only unplanned human acts and grades one step down for each failing group', async () => {
    const t = await trust.ticketTrust(payload, A)
    const by = Object.fromEntries(t.groups.map((g) => [g.id, g]))
    expect(by.checks).toMatchObject({ pass: true, lines: [{ text: 'CI on the merged head: 5 of 5 checks passed', pass: true }] })
    expect(by.proof!.pass).toBe(true)
    expect(by.proof!.lines.map((l) => l.text)).toContain('Staging accepted')
    expect(by.review).toMatchObject({ pass: true })
    expect(by.review!.lines.map((l) => l.text)).toEqual(['Review sent it back 1 time', '1 Important finding found, fixed (the final review is clean)', 'No escalations'])
    expect(by.interventions).toMatchObject({ pass: false, lines: [{ text: '1 human intervention outside the planned gates' }] })
    expect(t.grade).toBe('B')
    expect(t.facts).toMatchObject({ interventions: 1, sendBacks: [{ stage: 'review', by: 'review' }, { stage: 'review', by: 'human' }] })
  })

  it('prices the Ticket like the Cost panel and sets it against the Product median of the last 90 days', async () => {
    const t = await trust.ticketTrust(payload, A)
    expect(t.cost).toMatchObject({ usd: 4, estimated: true, unreported: 0 })
    expect(t.cost.vsMedian).toBeCloseTo(4 / 3)
  })

  it('says so when data is missing instead of guessing', async () => {
    const t = await trust.ticketTrust(payload, B)
    const by = Object.fromEntries(t.groups.map((g) => [g.id, g]))
    expect(by.checks).toMatchObject({ pass: null, lines: [{ text: 'No CI result recorded for this Ticket' }] })
    expect(by.review!.lines[0]).toMatchObject({ text: 'No review Run yet', pass: null })
    expect(t.grade).toBe('A')
  })
})

describe('Insights trust', () => {
  it('aggregates the done Tickets of the range per Product, with escaped defects and reverts', async () => {
    await payload.create({ collection: 'tickets', data: { title: 'bug', externalId: 'b1', number: 10, state: 'open', labels: ['type:bug'], causedBy: A, product, workspace: ws } as never, ...o })
    await payload.create({ collection: 'tickets', data: { title: 'old cause', externalId: 'b2', number: 11, state: 'open', labels: ['type:bug'], causedBy: (await payload.find({ collection: 'tickets', where: { number: { equals: 3 } }, ...o })).docs[0]!.id, product, workspace: ws } as never, ...o })
    const [p] = await insights.loadTrust(payload, DEFAULT(), ws, { days: 30, product: null, reverts: async () => ({ reverts: 1, merged: 20 }) })
    expect(p).toMatchObject({ product: { name: 'web' }, done: 2, interventionsPerTicket: 0.5, reworkRate: 0.5, sendBacksPerTicket: 1, costPerChange: 2.5, escaped: 1, reverts: { reverts: 1, merged: 20 }, grades: { A: 1, B: 1, C: 0, D: 0 } })
    expect(p!.sendBacks).toEqual([{ stage: 'review', by: 'human', count: 1 }, { stage: 'review', by: 'review', count: 1 }])
    expect(p!.earned.met).toBe(false)
    const wide = await insights.loadTrust(payload, DEFAULT(), ws, { days: 90, product, reverts: async () => null })
    expect(wide[0]).toMatchObject({ done: 3, reverts: null })
  })
})

describe('Triage causedBy', () => {
  it('is validated as a Ticket number', () => {
    expect(actions.normalizeTriage({ outcome: 'plan', reason: 'ok', causedBy: 7 }).causedBy).toBe(7)
    expect(actions.normalizeTriage({ outcome: 'plan', reason: 'ok' }).causedBy).toBeUndefined()
    for (const bad of [0, -1, 1.5, '7', null]) expect(() => actions.normalizeTriage({ outcome: 'plan', reason: 'ok', causedBy: bad })).toThrow('causedBy must be a Ticket number')
  })

  it('is stored on a bug Ticket for a Ticket of the same Product and ignored for others', async () => {
    const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
    const byNumber = async (n: number) => (await payload.find({ collection: 'tickets', where: { number: { equals: n } }, limit: 1, ...o })).docs[0] as Record<string, any>
    const bug = await fake.tickets('acme/trust').create({ title: 'broken', labels: ['type:bug'] })
    const feature = await fake.tickets('acme/trust').create({ title: 'new', labels: ['type:feature'] })
    await poll()
    const [b, f] = [await byNumber(bug.number), await byNumber(feature.number)]
    await actions.submitTriage(payload, b.id, actions.normalizeTriage({ outcome: 'plan', reason: 'x', causedBy: 1 }))
    await actions.submitTriage(payload, f.id, actions.normalizeTriage({ outcome: 'plan', reason: 'x', causedBy: 1 }))
    expect((await byNumber(bug.number)).causedBy).toBe(A)
    expect((await byNumber(feature.number)).causedBy ?? null).toBeNull()
    const unknown = await fake.tickets('acme/trust').create({ title: 'broken 2', labels: ['type:bug'] })
    await poll()
    const u = await byNumber(unknown.number)
    await actions.submitTriage(payload, u.id, actions.normalizeTriage({ outcome: 'plan', reason: 'x', causedBy: 999 }))
    expect((await byNumber(unknown.number)).causedBy ?? null).toBeNull()
  })
})
