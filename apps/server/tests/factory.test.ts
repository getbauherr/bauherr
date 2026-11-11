import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let factory: typeof import('../src/lib/factory')
let wfLib: typeof import('../src/lib/workflow')
let jobs: typeof import('../src/jobs')
let a: number
let b: number
const o = { overrideAccess: true } as const
type Doc = Record<string, any>

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('factory_apply')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  factory = await import('../src/lib/factory')
  wfLib = await import('../src/lib/workflow')
  jobs = await import('../src/jobs')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const space = async (slug: string, repo: string) => {
    const ws = (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode: 'session' }, ...o })).id as number
    const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws }, ...o })).id as number
    const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
    return { ws, product }
  }
  a = (await space('acme', 'acme/web')).ws
  b = (await space('beta', 'beta/web')).ws
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const by = { by: 'admin@x.io', via: 'api' } as const
const edit = async (ws: number, fn: (d: Doc) => void): Promise<string> => {
  const d = parse(await factory.exportFactory(payload, ws)) as Doc
  fn(d)
  return stringify(d)
}
const stageDoc = (d: Doc, name: string) => d.workflow.stages.find((s: Doc) => s.name === name) as Doc
/** Renames a stage in the document: its name and every outcome that targets it. */
const renameStage = (d: Doc, from: string, to: string) => {
  for (const s of d.workflow.stages as Doc[]) {
    if (s.name === from) s.name = to
    for (const [k, v] of Object.entries(s.outcomes ?? {})) if (v === from) s.outcomes[k] = to
  }
}
const versions = async (ws: number) => (await payload.count({ collection: 'workflow_versions', where: { workspace: { equals: ws } }, ...o })).totalDocs
const pointer = async (ws: number) => ((await payload.findByID({ collection: 'workspaces', id: ws, depth: 0, ...o })) as Doc).workflowVersion
const seedTicket = async (ws: number, repo: string, stage: string, extra: Doc = {}) => {
  const issue = await fake.tickets(repo).create({ title: `t-${stage}`, labels: [`bauherr:stage:${stage}`] })
  const product = (await payload.find({ collection: 'products', where: { workspace: { equals: ws } }, limit: 1, depth: 0, ...o })).docs[0]!.id
  return (await payload.create({ collection: 'tickets', data: { title: `t-${stage}`, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws, ...extra }, ...o })).id as number
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Doc

it('apply stores a version, moves the pointer, and a re-apply of the same content is a no-op', async () => {
  const yaml = await edit(a, (d) => (stageDoc(d, 'build').title = 'Construction'))
  const r = await factory.applyFactory(payload, a, yaml, { ...by, note: 'first' })
  expect(r).toMatchObject({ ok: true, version: 1, changed: true, migrated: [] })
  const row = (await payload.find({ collection: 'workflow_versions', where: { workspace: { equals: a } }, depth: 0, ...o })).docs[0] as Doc
  expect(row).toMatchObject({ version: 1, appliedBy: 'admin@x.io', appliedVia: 'api', note: 'first' })
  expect(row.hash).toMatch(/^[0-9a-f]{64}$/)
  expect(row.compiled.stages.find((s: Doc) => s.name === 'build').title).toBe('Construction')
  expect(row.compiled.roles[0].profile).toContain('Mission')
  expect(await pointer(a)).toBe(row.id)
  expect(wfLib.title(factory.workflowFor(a), 'build')).toBe('Construction')
  expect(wfLib.title(factory.workflowFor(b), 'build')).toBe('Build')
  expect(await factory.applyFactory(payload, a, yaml, by)).toMatchObject({ ok: true, version: 1, changed: false })
  expect(await versions(a)).toBe(1)
  expect((await payload.find({ collection: 'human_touches', where: { kind: { equals: 'apply:factory' } }, ...o })).docs).toHaveLength(1)
  expect(await factory.exportFactory(payload, a)).toBe(yaml)
  expect(await factory.exportFactory(payload, b)).toContain('Mission')
})

it('lint and context findings block the apply', async () => {
  const before = await versions(a)
  const bad = async (fn: (d: Doc) => void) => factory.applyFactory(payload, a, await edit(a, fn), by)
  expect((await bad((d) => (stageDoc(d, 'build').skill = 'nope'))).findings.join()).toMatch(/skill "nope"/)
  expect((await bad((d) => (d.team.roles.engineer = { title: 'E', provider: 'ghost', model: 'm' }))).findings.join()).toMatch(/provider "ghost"/)
  expect((await bad((d) => (d.team.roles.engineer.tier = 'huge'))).findings.join()).toMatch(/tier "huge"/)
  expect((await bad((d) => (stageDoc(d, 'build').outcomes.done = 'ghost'))).findings.join()).toMatch(/unknown stage "ghost"/)
  expect((await bad((d) => (d.team.roles.engineer.profile_file = '../../etc/passwd'))).findings.join()).toMatch(/must stay inside/)
  expect(await factory.applyFactory(payload, a, 'a: [', by)).toMatchObject({ ok: false })
  expect(await versions(a)).toBe(before)
})

it('a rename with migrate rewrites Tickets and Runs, the Run continues, the alias resolves and the poller fixes the forge label', async () => {
  const t = await seedTicket(a, 'acme/web', 'build')
  const waiter = await seedTicket(a, 'acme/web', 'plan', { waitingFor: 'build' })
  const run = (await payload.create({ collection: 'runs', data: { ticket: t, stage: 'build', status: 'running', mode: 'session', workspace: a }, ...o })).id as number
  const yaml = await edit(a, (d) => {
    renameStage(d, 'build', 'code')
    d.workflow.migrate = { build: 'code' }
  })
  const refused = await factory.applyFactory(payload, a, await edit(a, (d) => renameStage(d, 'build', 'code')), by)
  expect(refused.ok).toBe(false)
  expect(refused.findings.join()).toMatch(/stage "build" is removed but holds 1 Ticket\(s\) and 1 active Run\(s\)/)
  expect(refused.held).toEqual([{ stage: 'build', tickets: 1, runs: 1 }])
  expect(await factory.applyFactory(payload, a, yaml, { ...by, dryRun: true })).toMatchObject({ ok: true, migrated: [{ from: 'build', to: 'code', tickets: 2, runs: 1 }] })
  expect(await versions(a)).toBe(1)

  expect(await factory.applyFactory(payload, a, yaml, { ...by, baseVersion: 1 })).toMatchObject({ ok: true, version: 2, migrated: [{ from: 'build', to: 'code', tickets: 2, runs: 1 }] })
  expect(await reload(t)).toMatchObject({ stage: 'code', factoryStage: null })
  expect(await reload(waiter)).toMatchObject({ stage: 'plan', waitingFor: 'code' })
  expect(await payload.findByID({ collection: 'runs', id: run, depth: 0, ...o })).toMatchObject({ stage: 'code', status: 'running', kind: 'build' })
  const wf = factory.workflowFor(a)
  expect(wfLib.stage(wf, 'build')?.name).toBe('code')
  expect(wf.aliases).toEqual({ build: 'code' })
  expect(((await payload.findByID({ collection: 'workspaces', id: a, depth: 0, ...o })) as Doc).wipLimits).toBeNull()

  const number = (await reload(t)).number as number
  expect((await fake.tickets('acme/web').get(String(number))).labels).toContain('bauherr:stage:build')
  await (jobs.pollTickets.handler as (x: unknown) => Promise<unknown>)({ req: { payload } })
  const labels = (await fake.tickets('acme/web').get(String(number))).labels
  expect(labels).toContain('bauherr:stage:code')
  expect(labels).not.toContain('bauherr:stage:build')
  expect(await reload(t)).toMatchObject({ stage: 'code' })
  expect((await fake.tickets('acme/web').listComments(String(number))).map((c) => c.body).join()).not.toMatch(/stage-rejected|moved the stage back/)
})

it('a migrate to a stage of a different kind cancels the active Runs of the stage', async () => {
  const t = await seedTicket(a, 'acme/web', 'plan')
  const run = (await payload.create({ collection: 'runs', data: { ticket: t, stage: 'plan', status: 'awaiting_session', mode: 'session', workspace: a }, ...o })).id as number
  const yaml = await edit(a, (d) => {
    renameStage(d, 'plan', 'design')
    d.workflow.migrate = { plan: 'code' }
  })
  const r = await factory.applyFactory(payload, a, yaml, { ...by, baseVersion: 2 })
  expect(r).toMatchObject({ ok: true, version: 3, migrated: [expect.objectContaining({ from: 'plan', to: 'code' })] })
  expect(await payload.findByID({ collection: 'runs', id: run, depth: 0, ...o })).toMatchObject({ stage: 'plan', status: 'cancelled' })
  expect(await reload(t)).toMatchObject({ stage: 'code' })
  expect(factory.workflowFor(a).aliases).toEqual({ build: 'code', plan: 'code' })
})

it('two applies from the same base version: one wins, the other gets the stale finding', async () => {
  const x = await edit(b, (d) => (stageDoc(d, 'build').title = 'X'))
  const y = await edit(b, (d) => (stageDoc(d, 'build').title = 'Y'))
  const results = await Promise.all([x, y].map((yaml) => factory.applyFactory(payload, b, yaml, { ...by, baseVersion: 0 })))
  expect(results.filter((r) => r.ok)).toHaveLength(1)
  expect(results.find((r) => !r.ok)?.findings).toEqual(['the workflow changed since you loaded it'])
  expect(await versions(b)).toBe(1)
})

it('each Workspace follows its own workflow in one process', async () => {
  const c = (await payload.create({ collection: 'workspaces', data: { name: 'gamma', slug: 'gamma', defaultMode: 'session' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'gamma', slug: 'gamma', workspace: c }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: c }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'gamma/web', product, connection, workspace: c }, ...o })
  const renamed = parse(await (await import('node:fs/promises')).readFile(fileURLToPath(new URL('./fixtures/renamed-pack/factory.yaml', import.meta.url)), 'utf8'))
  expect(await factory.applyFactory(payload, c, stringify(renamed), by)).toMatchObject({ ok: true, version: 1 })
  const d = await fake.tickets('gamma/web').create({ title: 'gamma ticket' })
  const n = await fake.tickets('acme/web').create({ title: 'acme ticket' })
  await (jobs.pollTickets.handler as (x: unknown) => Promise<unknown>)({ req: { payload } })
  const runOf = async (number: number, repo: string) => {
    const t = (await payload.find({ collection: 'tickets', where: { number: { equals: number }, url: { contains: repo } }, limit: 1, depth: 0, ...o })).docs[0] as Doc
    return ((await payload.find({ collection: 'runs', where: { ticket: { equals: t.id } }, depth: 0, ...o })).docs[0] as Doc | undefined)
  }
  expect(await runOf(d.number, 'gamma')).toMatchObject({ stage: 'intake', kind: 'triage' })
  expect(await runOf(n.number, 'acme')).toMatchObject({ stage: 'triage', kind: 'triage' })
})

it('boot: a valid BAUHERR_FACTORY_FILE is applied once; an invalid one keeps the active version', async () => {
  const w = (await payload.create({ collection: 'workspaces', data: { name: 'boot', slug: 'boot' }, ...o })).id as number
  const dir = mkdtempSync(join(tmpdir(), 'bauherr-boot-'))
  const file = join(dir, 'factory.yaml')
  writeFileSync(file, await edit(w, (d) => (stageDoc(d, 'review').title = 'Inspection')))
  process.env.BAUHERR_FACTORY_FILE = file
  process.env.BAUHERR_FACTORY_WORKSPACE = 'boot'
  try {
    await factory.applyBootFile(payload)
    await factory.applyBootFile(payload)
    expect(await versions(w)).toBe(1)
    expect(wfLib.title(factory.workflowFor(w), 'review')).toBe('Inspection')
    writeFileSync(file, 'version: 1\nworkflow: {stages: []}\n')
    await factory.applyBootFile(payload)
    expect(await versions(w)).toBe(1)
    expect(wfLib.title(factory.workflowFor(w), 'review')).toBe('Inspection')
  } finally {
    delete process.env.BAUHERR_FACTORY_FILE
    delete process.env.BAUHERR_FACTORY_WORKSPACE
  }
})

it('the API: an agent key and a non-Admin are refused, an Admin can check, apply and export', async () => {
  const { rotateApiKey, mintAgentKey } = await import('../src/lib/api-key')
  const route = await import('../src/app/api/workspaces/[slug]/factory/route')
  const user = (email: string, role: string) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role, tenants: [{ tenant: a }] } as never, ...o }) as Promise<Doc>
  const admin = await user('admin@x.io', 'admin')
  const member = await user('member@x.io', 'bauherr')
  const adminKey = await rotateApiKey(payload, admin as { id: number })
  const memberKey = await rotateApiKey(payload, member as { id: number })
  const agentKey = await mintAgentKey(payload, admin as { id: number }, 'laptop')
  const call = (method: 'GET' | 'PUT', key: string | null, { body, query = '', headers = {} }: { body?: string; query?: string; headers?: Record<string, string> } = {}) =>
    (method === 'GET' ? route.GET : route.PUT)(new Request(`http://x/api/workspaces/acme/factory${query}`, { method, body, headers: { ...(key && { authorization: `Bearer ${key}` }), ...headers } }), { params: Promise.resolve({ slug: 'acme' }) })
  expect((await call('GET', agentKey)).status).toBe(403)
  expect((await call('PUT', agentKey, { body: 'x' })).status).toBe(403)
  expect((await call('GET', memberKey)).status).toBe(403)
  expect((await call('GET', null)).status).toBe(401)
  const got = await call('GET', adminKey)
  expect(got.status).toBe(200)
  expect(got.headers.get('content-type')).toMatch(/text\/yaml/)
  const yaml = await got.text()
  expect(await (await call('PUT', adminKey, { body: yaml, query: '?dryRun=1' })).json()).toMatchObject({ ok: true, changed: false })
  const next = stringify(Object.assign(parse(yaml), {}) as Doc).replace('title: Review', 'title: Peer review')
  const current = (await factory.activeVersion(payload, a))!.version
  expect((await call('PUT', adminKey, { body: next, headers: { 'if-match': String(current - 1) } })).status).toBe(409)
  const ok = await call('PUT', adminKey, { body: next, headers: { 'if-match': String(current) } })
  expect(ok.status).toBe(200)
  expect(await ok.json()).toMatchObject({ ok: true, version: current + 1, changed: true })
  expect((await call('PUT', adminKey, { body: 'version: 2', headers: {} })).status).toBe(422)
})
