import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { parse, stringify } from 'yaml'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let signedIn: { user: unknown; workspace: { id: number } }
vi.mock('../src/app/(app)/lib/session', () => ({ currentWorkspace: async () => signedIn, payloadClient: async () => payload, workspacesOf: async () => [] }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let actions: typeof import('../src/app/(app)/(shell)/setup/actions')
let setupLib: typeof import('../src/app/(app)/lib/setup')
let factory: typeof import('../src/lib/factory')
let wf: typeof import('../src/lib/workflow')
let presets: typeof import('../src/lib/presets')
let jobs: typeof import('../src/jobs')
let fake: FakeBackend
let admin: unknown
let member: Record<string, any>
const o = { overrideAccess: true } as const
const form = (data: Record<string, string>) => Object.entries(data).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData())
const REPO = 'acme/wizard'

const workspace = async (slug: string, repo = `acme/${slug}`) => {
  const ws = (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode: 'session' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws, stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws, capabilities: { verifiedAt: '2026-01-01' } }, ...o })).id as number
  await payload.create({ collection: 'repositories', data: { fullName: repo, product, workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  return { ws, product }
}
const as = (ws: number, user = admin) => (signedIn = { user, workspace: { id: ws } })
const apply = async (ws: number, preset: string) => (as(ws), actions.applyPreset({}, form({ preset })))

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('setup_wizard')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/app/(app)/(shell)/setup/actions')
  setupLib = await import('../src/app/(app)/lib/setup')
  factory = await import('../src/lib/factory')
  wf = await import('../src/lib/workflow')
  presets = await import('../src/lib/presets')
  jobs = await import('../src/jobs')
  await factory.loadWorkflows(payload)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const done = async (ws: number) => Object.fromEntries((await setupLib.loadSetup(ws)).steps.map((s) => [s.id, s.done]))

it('every preset lints clean, and Standard is the shipped default file plus a conditional security review', () => {
  for (const id of presets.PRESETS) expect(wf.lint(parse(presets.presetSource(id))), id).toEqual([])
  const standard = presets.presetWorkflow('standard')
  const shipped = wf.compile(parse(factory.packSource()))
  expect(wf.stage(standard, 'security-review')).toMatchObject({ kind: 'agent', role: 'security', when: { touches: 'security' } })
  expect(wf.target(standard, 'build', 'done')).toBe('security-review')
  const withoutSecurity = { ...standard, stages: standard.stages.filter((s) => s.name !== 'security-review').map((s) => (s.name === 'build' ? { ...s, outcomes: { ...s.outcomes, done: 'review' } } : s)) }
  expect(withoutSecurity).toEqual(shipped)
})

it('Solo: one engineer works every stage, plans pass, production is asked', async () => {
  const { ws } = await workspace('solo')
  expect(await apply(ws, 'solo')).toMatchObject({ saved: true })
  const w = factory.workflowFor(ws)
  expect(w.roles.map((r) => r.id)).toEqual(['engineer'])
  expect(wf.order(w)).toEqual(['triage', 'plan', 'parent', 'build', 'review', 'release', 'done'])
  expect(new Set(w.stages.map((s) => s.role).filter(Boolean))).toEqual(new Set(['engineer']))
  expect(wf.gates(w)).toEqual({ plan: false, staging: false, production: true })
})

it('Standard is the pack default workflow plus the security review, with the approve-plan gate', async () => {
  const { ws } = await workspace('standard')
  expect(await apply(ws, 'standard')).toMatchObject({ saved: true })
  expect(wf.order(factory.workflowFor(ws))).toEqual(['triage', 'plan', 'parent', 'build', 'security-review', 'review', 'release', 'done'])
  expect(wf.gates(factory.workflowFor(ws))).toEqual({ plan: true, staging: true, production: true })
  expect(factory.workflowFor(ws).roles.map((r) => r.id)).toEqual(['orchestrator', 'engineer', 'reviewer', 'security', 'ux', 'test', 'docs'])
})

it('Careful adds the three conditional specialist stages between Build and Review, staging acceptance, and the specialist roles', async () => {
  const { ws } = await workspace('careful')
  expect(await apply(ws, 'careful')).toMatchObject({ saved: true })
  const w = factory.workflowFor(ws)
  expect(wf.order(w)).toEqual(['triage', 'plan', 'parent', 'build', 'security-review', 'ux-review', 'test-review', 'review', 'release', 'done'])
  expect(wf.stage(w, 'security-review')).toMatchObject({ kind: 'agent', role: 'security', skill: 'mr-security-review', when: { touches: 'security' } })
  expect(wf.stage(w, 'ux-review')).toMatchObject({ kind: 'agent', role: 'ux', skill: 'ux-review', when: { touches: 'ui' } })
  expect(wf.stage(w, 'test-review')).toMatchObject({ kind: 'agent', role: 'test', skill: 'test-review', when: { types: ['bug'] } })
  expect(wf.target(w, 'build', 'done')).toBe('security-review')
  expect(wf.target(w, 'security-review', 'pass')).toBe('ux-review')
  expect(wf.target(w, 'test-review', 'pass')).toBe('review')
  expect(wf.target(w, 'test-review', 'findings')).toBe('build')
  expect(wf.gates(w)).toEqual({ plan: true, staging: true, production: true })
  expect(w.roles.map((r) => r.id)).toEqual(expect.arrayContaining(['security', 'ux', 'test', 'docs']))
  const row = (await payload.db.drizzle.execute(sql`SELECT "note", "applied_via" AS via, "applied_by" AS by FROM "workflow_versions" WHERE "workspace_id" = ${ws}`)).rows[0]
  expect(row).toMatchObject({ note: 'Setup: Careful team', via: 'ui', by: 'admin@x.io' })
})

it('a Member cannot apply a preset or skip the session step; an unknown preset is refused', async () => {
  const { ws } = await workspace('guarded')
  as(ws, member)
  expect(await actions.applyPreset({}, form({ preset: 'solo' }))).toEqual({ error: 'Only an Admin can change this.' })
  expect(await actions.skipSession({}, form({}))).toEqual({ error: 'Only an Admin can change this.' })
  as(ws)
  expect(await actions.applyPreset({}, form({ preset: 'wild' }))).toEqual({ error: 'Choose a team.' })
  expect((await done(ws)).team).toBe(false)
})

it('the team step is Done by an applied preset, the session step by a skip, and a skip leaves the Workspace without a Runner', async () => {
  const { ws } = await workspace('steps')
  expect(await done(ws)).toMatchObject({ forge: true, product: true, team: false, session: false, request: false })
  await apply(ws, 'standard')
  expect(await done(ws)).toMatchObject({ team: true, session: false })
  expect(await actions.skipSession({}, form({}))).toMatchObject({ saved: true })
  expect(await done(ws)).toMatchObject({ session: true })
  const s = await setupLib.loadSetup(ws)
  expect(s.facts).toMatchObject({ sessionSkipped: true, sessionEver: false, llmConnection: false })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ workspace: { equals: ws } }, { kind: { equals: 'setup:skip-session' } }] }, ...o })).toMatchObject({ totalDocs: 1 })
})

it('an open issue becomes an untriaged Ticket once; closed and unknown issues are refused', async () => {
  const { ws, product } = await workspace('issues', REPO)
  const open = await fake.tickets(REPO).create({ title: 'Add an export' })
  const closed = await fake.tickets(REPO).create({ title: 'Old thing' })
  await fake.tickets(REPO).close(closed.id, 'completed')
  as(ws)
  expect((await done(ws)).request).toBe(false)
  const finish = { digest: expect.stringMatching(/^NEXT_REDIRECT;.*\/setup;/) }
  await expect(actions.importIssue({}, form({ number: String(open.number) }))).rejects.toMatchObject(finish)
  await expect(actions.importIssue({}, form({ manual: `#${open.number}` }))).rejects.toMatchObject(finish)
  const tickets = (await payload.find({ collection: 'tickets', where: { product: { equals: product } }, depth: 0, ...o })).docs as Record<string, any>[]
  expect(tickets).toHaveLength(1)
  expect(tickets[0]).toMatchObject({ number: open.number, title: 'Add an export', state: 'open', workspace: ws })
  expect(tickets[0]!.stage ?? null).toBeNull()
  expect((await done(ws)).request).toBe(true)
  expect(await actions.importIssue({}, form({ number: String(closed.number) }))).toEqual({ error: `Issue #${closed.number} is closed.` })
  expect(await actions.importIssue({}, form({ number: '999' }))).toMatchObject({ error: expect.stringContaining('#999') })
  expect(await actions.importIssue({}, form({ number: 'abc' }))).toMatchObject({ error: expect.stringContaining('issue number') })
})

/** A Workspace on a factory file, with a Ticket driven to the Build stage (plan approved). */
const drive = async (slug: string, preset: string, edit?: (d: Record<string, any>) => void) => {
  const repo = `acme/${slug}`
  const { ws } = await workspace(slug, repo)
  if (edit) {
    const d = parse(presets.presetSource(preset as 'careful'))
    edit(d)
    as(ws)
    const r = await factory.applyFactory(payload, ws, stringify(d), { by: 'admin@x.io', via: 'api' })
    expect(r.findings).toEqual([])
  } else await apply(ws, preset)
  const { callTool } = await import('../src/lib/mcp-tools')
  const call = (user: any, name: string, input: unknown) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  const m = await payload.create({ collection: 'bauherren', data: { email: `${slug}@x.io`, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const issue = await fake.tickets(repo).create({ title: 'Route me' })
  const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
  await poll()
  const id = ((await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: ws } }, { number: { equals: issue.number } }] }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>).id as number
  const stage = async () => ((await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>).stage
  const claim = async (st: string) => {
    const run = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: st } }, { status: { equals: 'awaiting_session' } }] }, sort: 'createdAt', depth: 0, pagination: false, ...o })).docs.at(-1) as Record<string, any>
    const claimed = await claimOnly(payload, call, m, ws, run.id)
    return { runId: run.id as number, leaseToken: claimed.leaseToken as string, claimed }
  }
  const mr = async () => {
    const head = `bauherr/${issue.number}-feat`
    if (!(await fake.forge.listBranches(repo)).some((b) => b.name === head)) await fake.forge.createBranch(repo, head)
    fake.commit(repo, head, 'a.ts', `x${Math.random()}`)
    const pr = (await fake.forge.listPullRequests(repo)).find((p) => p.head === head && p.state === 'open') ?? (await fake.forge.openPullRequest(repo, { title: 'route', body: 'Done\n\n## Evidence\n| Goal | verified |\n', head, base: 'main' }))
    fake.setChecks(repo, pr.headSha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
    return pr
  }
  const runs = async (st: string) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: st } }] }, depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
  const labels = async () => (await fake.tickets(repo).get(String(issue.number))).labels
  const planAndApprove = async () => {
    const plan = await claim('plan')
    await call(m, 'submit_plan', { runId: plan.runId, leaseToken: plan.leaseToken, markdown: '## TL;DR\nDecision: build it\nRecommendation: yes\nWhy:\n- small\nRisk: none\n\n## Goal\nroute' })
    await call(m, 'finish_run', { runId: plan.runId, leaseToken: plan.leaseToken, status: 'succeeded' })
    await poll()
    expect(await stage()).toBe('plan')
    await call(m, 'approve', { ticket: id, gate: 'plan' })
    await poll()
    expect(await stage()).toBe('build')
  }
  const t = await claim('triage')
  await call(m, 'submit_triage', { runId: t.runId, leaseToken: t.leaseToken, outcome: 'plan', reason: 'clear' })
  await poll()
  await planAndApprove()
  const build = async () => {
    const b = await claim('build')
    const pr = await mr()
    await call(m, 'finish_run', { runId: b.runId, leaseToken: b.leaseToken, status: 'succeeded', prUrl: pr.url })
  }
  return { id, m, call, claim, stage, runs, labels, planAndApprove, build, poll }
}

/** Careful with the security review unconditional: these tests drive the outcomes, not the condition (tests/conditional-stages.test.ts covers that). */
const always = (doc: Record<string, any>) => delete (doc.workflow.stages as Record<string, any>[]).find((s) => s.name === 'security-review')!.when

it('Careful routes a Ticket by the security outcomes: findings back to Build, pass on to Review (UX and test steps skip: no ui paths, no bug)', async () => {
  const d = await drive('route', 'careful', always)
  for (const outcome of ['findings', 'pass']) {
    await d.build()
    expect(await d.stage()).toBe('security-review')
    const sec = await d.claim('security-review')
    expect(sec.claimed.agent).toMatchObject({ stage: 'security-review', skill: 'mr-security-review', outcomes: ['pass', 'findings'], role: { id: 'security' } })
    await d.call(d.m, 'finish_run', { runId: sec.runId, leaseToken: sec.leaseToken, status: 'succeeded', outcome, comment: 'checked' })
    expect(await d.stage()).toBe(outcome === 'pass' ? 'review' : 'build')
  }
})

it('a Build that asks for a replan returns the Ticket to the plan stage: approval dropped, a new plan Run, approving again reaches build', async () => {
  const d = await drive('replan-build', 'careful')
  expect(await d.labels()).toContain('bauherr:approved:plan')
  const build = await d.claim('build')
  await d.call(d.m, 'finish_run', { runId: build.runId, leaseToken: build.leaseToken, status: 'succeeded', outcome: 'replan', comment: 'step 2 is impossible' })
  expect(await d.stage()).toBe('plan')
  expect(await d.labels()).not.toContain('bauherr:approved:plan')
  expect((await d.runs('plan')).filter((r) => r.status === 'awaiting_session')).toHaveLength(1)
  await d.planAndApprove()
})

it('an agent stage or a human stage that returns a Ticket to the plan stage plans again and asks for a new approval', async () => {
  const d = await drive('replan', 'careful', (doc) => {
    always(doc)
    doc.workflow.stages = (doc.workflow.stages as Record<string, any>[]).filter((s) => !['ux-review', 'test-review'].includes(s.name))
    const st = doc.workflow.stages as Record<string, any>[]
    st.find((s) => s.name === 'security-review')!.outcomes = { pass: 'signoff', findings: 'plan' }
    st.splice(st.findIndex((s) => s.name === 'security-review') + 1, 0, { name: 'signoff', kind: 'human', title: 'Sign-off', outcomes: { approve: 'review', reject: 'plan' } })
  })
  expect(await d.labels()).toContain('bauherr:approved:plan')
  await d.build()
  const sec1 = await d.claim('security-review')
  await d.call(d.m, 'finish_run', { runId: sec1.runId, leaseToken: sec1.leaseToken, status: 'succeeded', outcome: 'findings', comment: 'replan please' })
  expect(await d.stage()).toBe('plan')
  expect(await d.labels()).not.toContain('bauherr:approved:plan')
  expect((await d.runs('plan')).map((r) => r.status).sort()).toEqual(['awaiting_session', 'succeeded'])
  await d.poll()
  expect((await d.runs('plan')).filter((r) => r.status === 'awaiting_session')).toHaveLength(1)

  await d.planAndApprove()
  await d.build()
  const sec2 = await d.claim('security-review')
  await d.call(d.m, 'finish_run', { runId: sec2.runId, leaseToken: sec2.leaseToken, status: 'succeeded', outcome: 'pass' })
  expect(await d.stage()).toBe('signoff')
  await d.call(d.m, 'decide', { ticket: d.id, outcome: 'reject' })
  expect(await d.stage()).toBe('plan')
  expect(await d.labels()).not.toContain('bauherr:approved:plan')
  expect((await d.runs('plan')).filter((r) => r.status === 'awaiting_session')).toHaveLength(1)
})
