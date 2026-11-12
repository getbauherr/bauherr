import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadInbox } from '../src/app/(app)/lib/inbox'
import { mergeStrip } from '../src/app/(app)/lib/merge-strip'
import { resultsOf } from '../src/app/(app)/lib/knowledge'
import { ticketStatus, type StatusRow } from '../src/app/(app)/lib/status'
import { buildSteps } from '../src/app/(app)/lib/steps'
import type { Span } from '../src/lib/history'
import { DEFAULT } from '../src/lib/workflow'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let signedIn: { user: Record<string, any>; workspace: { id: number } }
vi.mock('../src/app/(app)/lib/session', () => ({ currentWorkspace: async () => signedIn, payloadClient: async () => payload, workspacesOf: async (u: { role: string }) => (u.role === 'admin' ? [] : [{ id: ws }]) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
let actions: typeof import('../src/app/(app)/(shell)/settings/actions')
let ws: number
let product: number
let admin: Record<string, any>
let member: Record<string, any>
const o = { overrideAccess: true } as const
const form = (data: Record<string, string | number>) => Object.entries(data).reduce((fd, [k, v]) => (fd.set(k, String(v)), fd), new FormData())
const productDoc = async () => (await payload.findByID({ collection: 'products', id: product, depth: 0, ...o })) as Record<string, any>

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('settings_rework')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/app/(app)/(shell)/settings/actions')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'rework', slug: 'rework' }, ...o })).id as number
  admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@rework.io', password: 'pw-123456', role: 'admin' }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'member@rework.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  product = (await payload.create({ collection: 'products', data: { name: 'Shop', slug: 'shop', workspace: ws, stagingUrl: 'https://staging.example.com', releaseMode: 'factory', checkRetries: 1 }, ...o })).id as number
  signedIn = { user: admin, workspace: { id: ws } }
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('Product tabs save only their own fields', () => {
  it('the Releases tab writes the pre-release switch and leaves the Deploy fields alone', async () => {
    expect(await actions.saveDeploy({}, form({ id: product, section: 'releases', releaseMode: 'factory', releaseReminderDays: 7, releasePrerelease: 'on' }))).toMatchObject({ saved: true })
    const p = await productDoc()
    expect(p).toMatchObject({ releasePrerelease: true, releaseMode: 'factory', stagingUrl: 'https://staging.example.com', checkRetries: 1 })
    expect(await actions.saveDeploy({}, form({ id: product, section: 'releases', releaseMode: 'factory', releaseReminderDays: 7 }))).toMatchObject({ saved: true })
    expect((await productDoc()).releasePrerelease).toBe(false)
  })

  it('the Approvals tab keeps the staging URL; the gate without a production check saves there and is refused on the Deploy tab', async () => {
    expect(await actions.saveDeploy({}, form({ id: product, section: 'approvals', autoMerge: 'on' }))).toMatchObject({ saved: true })
    expect(await productDoc()).toMatchObject({ autoMerge: true, stagingUrl: 'https://staging.example.com', productionGate: false })
    expect(await actions.saveDeploy({}, form({ id: product, section: 'approvals', productionGate: 'on' }))).toMatchObject({ saved: true })
    expect((await productDoc()).productionGate).toBe(true)
    expect(await actions.saveDeploy({}, form({ id: product, section: 'deploy', stagingUrl: 'https://staging.example.com', deployMode: 'observe-ci', productionChecks: '' }))).toMatchObject({ fields: { productionChecks: expect.any(String) } })
    expect(await actions.saveDeploy({}, form({ id: product, section: 'deploy', stagingUrl: 'https://staging.example.com', deployMode: 'observe-ci', productionChecks: 'deploy-prod' }))).toMatchObject({ saved: true })
    await actions.saveDeploy({}, form({ id: product, section: 'approvals', autoMerge: 'on' }))
    expect((await productDoc()).productionGate).toBe(false)
  })

  it('the Deploy tab saves the checks the form posts and keeps the Approvals fields', async () => {
    expect(await actions.saveDeploy({}, form({ id: product, section: 'deploy', stagingUrl: 'https://s2.example.com', deployMode: 'observe-ci', deployChecks: 'build' }))).toMatchObject({ saved: true })
    expect(await productDoc()).toMatchObject({ stagingUrl: 'https://s2.example.com', deployChecks: 'build', autoMerge: true })
    expect(await actions.saveDeploy({}, form({ id: product, section: 'deploy', stagingUrl: 'nope', deployMode: 'observe-ci' }))).toMatchObject({ fields: { stagingUrl: expect.any(String) } })
  })

  it('the Checks tab saves the retry count and the pre-review rules', async () => {
    expect(await actions.saveDeploy({}, form({ id: product, section: 'checks', checkRetries: 0, reviewChecks: 'src/** => tests/**' }))).toMatchObject({ saved: true })
    expect(await productDoc()).toMatchObject({ checkRetries: 0, stagingUrl: 'https://s2.example.com' })
    expect(await actions.saveDeploy({}, form({ id: product, section: 'checks', checkRetries: 2 }))).toMatchObject({ fields: { checkRetries: expect.any(String) } })
  })

  it('a widget token takes a session limit, 20 per hour by default', async () => {
    await actions.mintEmbedToken({}, form({ id: product, name: 'Footer', origins: 'https://shop.example.com', maxSessionsPerHour: 5 }))
    await actions.mintEmbedToken({}, form({ id: product, name: 'Header', origins: 'https://shop.example.com' }))
    expect(await actions.mintEmbedToken({}, form({ id: product, name: 'Bad', origins: 'https://shop.example.com', maxSessionsPerHour: 0 }))).toMatchObject({ fields: { maxSessionsPerHour: expect.any(String) } })
    const { loadProducts } = await import('../src/app/(app)/lib/settings')
    const tokens = (await loadProducts(ws)).products.find((p) => p.id === product)!.embedTokens
    expect(tokens.map((t) => [t.name, t.maxSessionsPerHour])).toEqual([['Footer', 5], ['Header', 20]])
  })
})

describe('Workspace settings split by page', () => {
  it('a member is refused every Models & budget, General and Knowledge write; an Admin saves them', async () => {
    signedIn = { user: member, workspace: { id: ws } }
    const before = (await payload.findByID({ collection: 'workspaces', id: ws, depth: 0, ...o })) as Record<string, any>
    for (const [action, data] of [[actions.saveModels, { budgetUnit: 'usd', budgetAmount: 12, routerBudgetShare: 30 }], [actions.saveGeneral, { name: 'Hacked' }], [actions.saveKnowledge, { knowledgeRepo: 'x/y' }]] as const) {
      expect(await action({}, form(data))).toMatchObject({ error: expect.stringContaining('Only an Admin') })
    }
    const after = (await payload.findByID({ collection: 'workspaces', id: ws, depth: 0, ...o })) as Record<string, any>
    expect(after).toMatchObject({ budgetUsd30d: before.budgetUsd30d, routerBudgetShare: before.routerBudgetShare, name: before.name })
    // The REST path (Payload local API with access control, as /api) is closed too.
    await expect(payload.update({ collection: 'workspaces', id: ws, data: { budgetUsd30d: 1 }, user: member, overrideAccess: false })).rejects.toThrow()
    expect(((await payload.findByID({ collection: 'workspaces', id: ws, depth: 0, ...o })) as Record<string, any>).budgetUsd30d).toBe(before.budgetUsd30d)
    signedIn = { user: admin, workspace: { id: ws } }
    expect(await actions.saveModels({}, form({ budgetUnit: 'usd', budgetAmount: 15, tier_cheap: 'a', tier_standard: 'b', tier_strong: 'c', defaultMode: 'session' }))).toMatchObject({ saved: true })
    const w = (await payload.findByID({ collection: 'workspaces', id: ws, depth: 0, ...o })) as Record<string, any>
    expect(w).toMatchObject({ budgetUsd30d: 15, name: 'rework', defaultMode: 'session', modelByTier: { cheap: 'a', standard: 'b', strong: 'c' } })
    expect(await actions.saveGeneral({}, form({ name: 'Rework Inc' }))).toMatchObject({ saved: true })
  })
})

describe('skill proposals in the Inbox', () => {
  it('an Admin gets an Approve skill proposal card with approve and reject, a member none', async () => {
    const ticket = (await payload.create({ collection: 'tickets', data: { title: 'Bound the retry loop', externalId: 'rw-1', number: 1, url: 'https://github.com/acme/web/issues/1', state: 'closed', labels: [], stage: 'done', product, workspace: ws }, ...o })).id as number
    await payload.create({ collection: 'skill_proposals', data: { ticket, workspace: ws, status: 'replayed', pr: 4, skillPath: 'workspace/skills/retry-limits/SKILL.md', score: 0.75, baselineScore: 0.25 }, ...o })
    const { groups } = await loadInbox(ws, { role: 'admin' })
    const card = groups.find((g) => g.checkpoint === 'Skill proposal')!.items[0]!
    expect(card.id).toBe(ticket)
    expect(card.decision.need).toBe('Approve skill proposal')
    expect(card.decision.ask).toContain('retry-limits')
    expect(card.decision.why[0]).toContain('75% against 25%')
    expect(card.decision.options.map((x) => x.action)).toEqual(['approveSkill', 'rejectSkill'])
    expect((await loadInbox(ws, { role: 'bauherr' })).groups).toEqual([])
    const { rejectSkillProposal } = await import('../src/lib/actions')
    await expect(rejectSkillProposal(payload, member, { proposal: 1 })).rejects.toThrow('Only an Admin')
    const done = await payload.find({ collection: 'skill_proposals', where: { ticket: { equals: ticket } }, ...o })
    await payload.update({ collection: 'skill_proposals', id: done.docs[0]!.id, data: { status: 'rejected' }, ...o })
    expect((await loadInbox(ws, { role: 'admin' })).groups).toEqual([])
  })
})

describe('events carry the workflow version', () => {
  it('record() stores the active version number, null for the pack default', async () => {
    const { record } = await import('../src/lib/history')
    const t = (await payload.create({ collection: 'tickets', data: { title: 'Versioned', externalId: 'rw-2', number: 2, url: 'https://github.com/acme/web/issues/2', state: 'open', labels: ['bauherr:stage:plan'], stage: 'plan', product, workspace: ws }, ...o })).id as number
    await record(payload, t, { stage: 'plan', phase: 'queued', cause: 'test:default' })
    const version = (await payload.create({ collection: 'workflow_versions', data: { version: 3, workspace: ws, compiled: {}, hash: 'h3' } as never, ...o })).id as number
    await payload.update({ collection: 'workspaces', id: ws, data: { workflowVersion: version }, ...o })
    await record(payload, t, { stage: 'plan', phase: 'working', cause: 'test:v3' })
    const events = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: t } }, sort: 'id', ...o })).docs as Record<string, any>[]
    expect(events.map((e) => e.workflowVersion ?? null)).toEqual([null, 3])
  })
})

describe('pure parts', () => {
  const wf = DEFAULT()
  const row = (track: StatusRow['track']): StatusRow => ({ open: true, stage: 'release', needsYou: null, blockedBy: [], queuedWhy: null, run: null, owner: null, forge: 'github', gate: null, track })

  it('ticketStatus names the release error as the reason', () => {
    expect(ticketStatus(wf, row({ releaseError: 'tag v1.2.0 already exists\nmore' }))).toMatchObject({ phase: 'failed', label: 'Failed', detail: 'Release not published: tag v1.2.0 already exists' })
    expect(ticketStatus(wf, row({}))).toMatchObject({ phase: 'queued' })
  })

  it('mergeStrip says who waits, what is building and who was dropped', () => {
    const t = (id: number, reviewState: string | null, trainFailures = 0) => ({ id, number: id + 400, reviewState, trainFailures })
    expect(mergeStrip('direct', null, [])).toBe('Merges directly, no queue')
    expect(mergeStrip('queue', null, [t(1, 'queued')])).toBe('Queue: 1 waiting')
    expect(mergeStrip('train', { members: [{ ticket: 1, pr: 9, headSha: 'a' }], phase: 'testing' }, [t(1, 'queued'), t(2, 'queued'), t(3, null, 1)])).toBe('Merge train: 2 queued, #401 building · dropped back to Build: #403 (1×)')
    expect(mergeStrip('train', { members: [{ ticket: 1, pr: 9, headSha: 'a' }], phase: 'bisect' }, [t(1, 'queued')])).toBe('Merge train: 1 queued, #401 bisecting')
  })

  it('resultsOf reduces the replay rows to pass or fail per case', () => {
    expect(resultsOf(null)).toBeNull()
    expect(resultsOf({ baseline: [{ id: 'a', pass: true }], withSkill: [{ id: 'a', pass: false }, { id: 'b', pass: true }], calls: 4, cost: 0.1 })).toEqual({ cases: [{ id: 'a', baseline: true, withSkill: false }, { id: 'b', baseline: null, withSkill: true }], calls: 4, cost: 0.1 })
  })

  it('a step shows the workflow version only when it differs from the active one', () => {
    const span = (id: number, workflowVersion: number | null): Span => ({ id, at: '2026-01-01T00:00:00Z', until: '2026-01-01T00:01:00Z', seconds: 60, stage: 'plan', stageKind: 'plan', phase: 'working', fromStage: null, outcome: null, run: null, executor: 'runner', actor: null, cause: null, backfilled: false, workflowVersion })
    const steps = buildSteps(wf, [span(1, 2), span(2, 3), span(3, null)], [], [], { current: 'plan', provider: null, admin: false, workflowVersion: 3 })
    expect(steps.visits[0]!.steps.map((s) => s.workflowVersion)).toEqual([2, null, null])
  })
})
