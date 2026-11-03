import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
let release: typeof import('../src/lib/release')
let mode: typeof import('../src/lib/mode')
let needs: typeof import('../src/lib/needs-you')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

/** `undefined` = the real pack/workflow.yaml. */
const usePack = (name?: 'gated-pack' | 'bare-pack') => {
  if (name) process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
  else delete process.env.BAUHERR_PACK_DIR
}

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('human_gates_175')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  release = await import('../src/lib/release')
  mode = await import('../src/lib/mode')
  needs = await import('../src/lib/needs-you')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  usePack()
  await payload?.destroy()
  await testDb?.drop(payload)
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const labelsOf = async (n: string) => (await fake.tickets(repo).get(n)).labels
const touches = async () => (await payload.count({ collection: 'human_touches', where: { kind: { not_equals: 'auto:staging' } }, ...o })).totalDocs
const autoTouches = async (ticket: number) => (await payload.count({ collection: 'human_touches', where: { and: [{ ticket: { equals: ticket } }, { kind: { equals: 'auto:staging' } }] }, ...o })).totalDocs
const runs = async (id: number, stage: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: stage } }] }, ...o })).docs

const PLAN = '## Goal\n- Ship it\n\n## Steps\n1. Do it'
const CRITICAL = `${PLAN}\n\n## Decisions\n- **D1 Storage, critical**. Default: postgres. Alternative: files.`
const SUBS = `${PLAN}\n\n## Sub-tickets\n- **Part A** — first.\n- **Part B** — second.\n`

/** A plan Ticket whose plan Run succeeded and whose plan Comment is posted. */
const planTicket = async (title: string, markdown = PLAN) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:plan'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  await actions.submitPlan(payload, user, { ticket: t.id as number, markdown })
  return { id: t.id as number, n: String(issue.number) }
}

/** A merged Ticket in release, its merge commit green on staging. */
const releaseTicket = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:release'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'release', product, workspace: ws, mergeSha: `sha-${issue.number}`, releaseAt: new Date().toISOString(), releaseState: 'waiting' }, ...o })
  fake.setChecks(repo, `sha-${issue.number}`, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  return { id: t.id as number, n: String(issue.number) }
}

describe('default workflow (plan and release gates off)', () => {
  it('lists refine and production as the default human gates', () => {
    usePack()
    expect(mode.humanGates()).toEqual(['refine', 'production'])
    expect([mode.gateOn('plan'), mode.gateOn('release')]).toEqual([false, false])
  })

  it('moves a posted plan to build without a label or human touch, and starts the Build Run', async () => {
    usePack()
    const { id, n } = await planTicket('auto')
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'build' })
    const labels = await labelsOf(n)
    expect(labels).toContain('bauherr:stage:build')
    expect(labels).not.toContain('bauherr:approved:plan')
    expect(await runs(id, 'build')).toHaveLength(1)
    expect(await touches()).toBe(0)
    expect(needs.needsYou({ stage: 'plan', labels: [] }, { stage: 'plan', status: 'succeeded' })).toBeNull()
    await poll()
    expect(await runs(id, 'build')).toHaveLength(1)
  })

  it('sends a plan with an open critical decision back to the refine hold; answering re-plans, then builds', async () => {
    usePack()
    const { id, n } = await planTicket('critical', CRITICAL)
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'triage' })
    const labels = await labelsOf(n)
    expect(labels).toContain('bauherr:needs-refinement')
    expect(labels.some((l) => l.startsWith('bauherr:stage:'))).toBe(false)
    expect(needs.needsYou({ stage: 'triage', labels }, null)).toBe('Answer questions')
    await poll()
    expect((await reload(id)).labels).toEqual(expect.arrayContaining(['bauherr:needs-refinement']))
    expect((await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:plan-refine:'))).toHaveLength(1)

    await actions.postDecisions(payload, user, { ticket: id, answers: [{ id: 'D1', title: 'Storage', answer: 'postgres' }] })
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'plan' })
    expect(await runs(id, 'plan')).toHaveLength(2)
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'plan' })

    await payload.update({ collection: 'runs', id: (await runs(id, 'plan')).find((r) => r.status !== 'succeeded')!.id, data: { status: 'succeeded' }, ...o })
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'build' })
    expect(await labelsOf(n)).not.toContain('bauherr:approved:plan')
    expect(await touches()).toBe(0)
  })

  it('sends the Sub-tickets of an auto plan straight to Build, without the approval label', async () => {
    usePack()
    const { id, n } = await planTicket('parent', SUBS)
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'parent' })
    const kids = await fake.tickets(repo).listSubTickets(n)
    expect(kids.map((k) => k.title)).toEqual(['Part A', 'Part B'])
    for (const k of kids) expect(k.labels).toEqual(['bauherr:stage:build'])
    expect(await touches()).toBe(0)
  })

  it('moves a merged Ticket confirmed on staging to the production gate of a Product that has it on', async () => {
    usePack()
    await payload.update({ collection: 'products', id: product, data: { productionChecks: 'deploy-prod' }, ...o })
    const { id, n } = await releaseTicket('prod gate')
    expect(await release.watchRelease(payload)).toMatchObject({ confirmed: 1 })
    expect(await reload(id)).toMatchObject({ stage: 'release', state: 'open', releaseState: 'on_staging', productionState: 'awaiting_approval' })
    expect(await labelsOf(n)).toContain('bauherr:approved:staging')
    const t = await reload(id)
    expect(needs.needsYou({ stage: t.stage, labels: await labelsOf(n), releaseState: t.releaseState, productionState: t.productionState }, null)).toBe('Approve production')
    expect(await touches()).toBe(0)
    await release.watchRelease(payload)
    expect(await reload(id)).toMatchObject({ productionState: 'awaiting_approval' })
  })
})

describe('staging gate off: the approved:staging label approves nothing', () => {
  it('an agent-set label neither skips passStaging nor the production gate; the poll strips it', async () => {
    usePack()
    await payload.update({ collection: 'products', id: product, data: { productionChecks: 'deploy-prod' }, ...o })
    const { id, n } = await releaseTicket('agent label')
    fake.actingAs = 'intruder'
    await fake.tickets(repo).addLabels(n, ['bauherr:approved:staging'])
    fake.actingAs = 'factory'
    await payload.update({ collection: 'tickets', id, data: { labels: ['bauherr:approved:staging'] }, ...o })
    expect(await release.watchRelease(payload)).toMatchObject({ confirmed: 1 })
    expect(await reload(id)).toMatchObject({ stage: 'release', state: 'open', productionState: 'awaiting_approval' })
    expect(await autoTouches(id)).toBe(1)
    await release.watchRelease(payload)
    expect(await autoTouches(id)).toBe(1)
    await poll()
    expect(await labelsOf(n)).toContain('bauherr:approved:staging')
    expect(await reload(id)).toMatchObject({ productionState: 'awaiting_approval' })
  })

  it('strips a label nobody recorded, with one Comment', async () => {
    usePack()
    const { n } = await releaseTicket('stripped')
    fake.actingAs = 'intruder'
    await fake.tickets(repo).addLabels(n, ['bauherr:approved:staging'])
    fake.actingAs = 'factory'
    await poll()
    await poll()
    expect(await labelsOf(n)).not.toContain('bauherr:approved:staging')
    expect((await fake.tickets(repo).listComments(n)).filter((c) => c.body.includes('gate is off'))).toHaveLength(1)
  })

  it('decides on production state, not on the label', () => {
    const t = { stage: 'release', labels: ['bauherr:approved:staging'], releaseState: 'on_staging' }
    expect(needs.needsYou(t, null, 0, ['refine', 'production'])).toBeNull()
    expect(needs.needsYou({ ...t, productionState: 'failed' }, null, 0, ['refine', 'production'])).toBe('Production deploy failed')
    expect(needs.needsYou({ ...t, labels: [], productionState: 'awaiting_approval' }, null, 0, ['refine', 'production'])).toBe('Approve production')
    expect(needs.needsYou({ ...t, labels: [] }, null, 0, ['refine', 'staging', 'production'])).toBe('Accept on staging')
    expect(needs.needsYou(t, null, 0, ['refine', 'staging', 'production'])).toBeNull()
  })
})

describe('production gate off or unconfigured', () => {
  afterEach(async () => {
    await payload.update({ collection: 'products', id: product, data: { productionChecks: '' }, ...o })
  })

  it('shows the Configure production checks gate, not done, when the gate is on and the Product has no productionChecks', async () => {
    usePack()
    await payload.update({ collection: 'products', id: product, data: { productionChecks: '' }, ...o })
    const { id, n } = await releaseTicket('no checks')
    await release.watchRelease(payload)
    const t = await reload(id)
    expect(t).toMatchObject({ stage: 'release', state: 'open', productionState: 'awaiting_approval' })
    const ticket = { stage: t.stage, labels: await labelsOf(n), releaseState: t.releaseState, productionState: t.productionState }
    expect(needs.needsYou({ ...ticket, productionChecksMissing: true }, null)).toBe('Configure production checks')
    await expect(actions.approveProduction(payload, user, { ticket: id })).rejects.toThrow('configure productionChecks')
    expect(await touches()).toBe(0)
  })

  it('gate turned off in the workflow: a Ticket confirmed on staging is done and closed, no touch', async () => {
    usePack('bare-pack')
    expect(mode.humanGates()).toEqual(['refine'])
    const { id, n } = await releaseTicket('done')
    await release.watchRelease(payload)
    expect(await reload(id)).toMatchObject({ stage: 'done', state: 'closed' })
    expect(await labelsOf(n)).toEqual(expect.arrayContaining(['bauherr:approved:staging', 'bauherr:stage:done']))
    expect(await touches()).toBe(0)
    expect(await autoTouches(id)).toBe(1)
  })

  it('recovers a Ticket left on_staging when the gate is off', async () => {
    usePack('bare-pack')
    const { id } = await releaseTicket('stuck')
    await payload.update({ collection: 'tickets', id, data: { releaseState: 'on_staging' }, ...o })
    await release.watchRelease(payload)
    expect(await reload(id)).toMatchObject({ stage: 'done', state: 'closed' })
  })
})

describe('gate: human on plan and release', () => {
  it('keeps the approval gates', async () => {
    usePack('gated-pack')
    expect(mode.humanGates()).toEqual(['refine', 'plan', 'staging'])
    const { id, n } = await planTicket('gated')
    await poll()
    expect(await reload(id)).toMatchObject({ stage: 'plan' })
    expect(await labelsOf(n)).toContain('bauherr:stage:plan')
    expect(needs.needsYou({ stage: 'plan', labels: [] }, { stage: 'plan', status: 'succeeded' })).toBe('Approve plan')
    expect(needs.needsYou({ stage: 'plan', labels: [] }, { stage: 'plan', status: 'succeeded' }, 1)).toBe('Answer decisions')

    const rel = await releaseTicket('gated release')
    await release.watchRelease(payload)
    const t = await reload(rel.id)
    expect(t).toMatchObject({ stage: 'release', releaseState: 'on_staging' })
    expect(await labelsOf(rel.n)).not.toContain('bauherr:approved:staging')
    expect(needs.needsYou({ stage: 'release', labels: [], releaseState: 'on_staging' }, null)).toBe('Accept on staging')
  })
})

describe('needsYou by gates', () => {
  const plan = { stage: 'plan', labels: [] as string[] }
  const rel = { stage: 'release', labels: [] as string[], releaseState: 'on_staging' }
  const succeeded = { stage: 'plan', status: 'succeeded' }
  it.each([
    [['refine'], null, null, null],
    [['refine', 'plan'], 'Approve plan', 'Answer decisions', null],
    [['refine', 'staging'], null, null, 'Accept on staging'],
  ] as const)('%j', (gates, approve, decisions, accept) => {
    expect(needs.needsYou(plan, succeeded, 0, gates)).toBe(approve)
    expect(needs.needsYou(plan, succeeded, 1, gates)).toBe(decisions)
    expect(needs.needsYou(rel, null, 0, gates)).toBe(accept)
  })

  it('keeps declared blockers on whatever the gates', () => {
    expect(needs.needsYou({ stage: 'release', labels: [], releaseState: 'timed_out' }, null, 0, ['refine'])).toBe('Staging not confirmed')
    expect(needs.needsYou({ stage: 'build', labels: [] }, { stage: 'build', status: 'needs_human' }, 0, ['refine'])).toBe('Run needs you')
    expect(needs.needsYou({ stage: 'triage', labels: ['bauherr:needs-refinement'] }, null, 0, ['refine'])).toBe('Answer questions')
  })
})
