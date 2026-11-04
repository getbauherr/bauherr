import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PLAN_MARKER } from '../src/app/(app)/lib/plan'
import { EXPEDITE_LABEL, EXPEDITE_PROPOSED, needsYou } from '../src/lib/needs-you'
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
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
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
const issue = (title: string, body = '', labels: string[] = [EXPEDITE_LABEL]) => fake.tickets(repo).create({ title, body, labels })

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

  it('the plan gate is off: the succeeded plan moves on to Build', async () => {
    const { fileURLToPath } = await import('node:url')
    process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
    const i = await issue('prod down')
    await poll()
    const t = await byNumber(i.number)
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
    await actions.submitPlan(payload, user, { ticket: t.id, markdown: '## Goal\n- x\n\n## Steps\n1. y' })
    await poll()
    expect(await reload(t.id)).toMatchObject({ stage: 'build' })
    expect(needsYou({ stage: 'plan', labels: [], expedite: true }, { stage: 'plan', status: 'succeeded' }, 0, ['plan'])).toBeNull()
    expect(needsYou({ stage: 'plan', labels: [], expedite: false }, { stage: 'plan', status: 'succeeded' }, 0, ['plan'])).toBe('Approve plan')
  })
})

describe('bypasses', () => {
  it('the overlap hold never holds an expedite Build, and later Tickets wait for it', async () => {
    const early = await inBuild('a', ['src/app/**'])
    const hot = await inBuild('z', ['src/app/page.tsx'], { expedite: true })
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

  it('Settings > Workflow off: the label is ignored with a Comment and Triage runs', async () => {
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
    expect(needsYou({ stage: proposed.stage, labels: proposed.labels, expedite: proposed.expedite }, null)).toBe('Expedite?')

    await actions.expedite(payload, user, { ticket: t.id })
    expect(await labelsOf(i.number)).toContain(EXPEDITE_LABEL)
    expect(await labelsOf(i.number)).not.toContain(EXPEDITE_PROPOSED)
    await poll()
    const done = await reload(t.id)
    expect(done.expedite).toBe(true)
    expect(needsYou({ stage: done.stage, labels: done.labels, expedite: done.expedite }, null)).toBeNull()
  })
})
