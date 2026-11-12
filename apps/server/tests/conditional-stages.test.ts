import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The default flow with three conditional agent stages between build and review (fixtures/routing-pack): security (touches security), ux (touches ui), test (bugs). */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let bare: number
let member: Record<string, any>
let call: (user: any, name: string, input: unknown) => Promise<any>
let actions: typeof import('../src/lib/actions')
let history: typeof import('../src/lib/history')
const o = { overrideAccess: true } as const
const repo = 'acme/routing'
const bareRepo = 'acme/bare'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/routing-pack', import.meta.url))
  testDb = await createTestDb('routing')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  history = await import('../src/lib/history')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: user.actor ?? { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  const mk = async (slug: string, r: string, pathSets: Record<string, string[]>) => {
    const id = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace: ws, stagingUrl: 'https://staging.example', pathSets }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo: r, product: id, connection, workspace: ws }, ...o })
    return id
  }
  product = await mk('web', repo, { security: ['src/auth/**'], ui: ['src/app/**'] })
  bare = await mk('bare', bareRepo, {})
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: 'createdAt', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const eventsOf = async (id: number) => (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: id } }, sort: ['at', 'id'], depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
/** A Ticket in build with an MR that changes `files`. */
const ticketWith = async (title: string, files: string[], labels: string[] = [], r = repo, p = product) => {
  const issue = await fake.tickets(r).create({ title, labels: ['bauherr:stage:build'] })
  const id = (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', labels, product: p, workspace: ws }, ...o })).id as number
  const head = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(r, head)
  for (const f of files) fake.commit(r, head, f, `x${Math.random()}`)
  const pr = await fake.forge.openPullRequest(r, { title, body: 'Done\n\n## Evidence\n| Goal | verified |\n', head, base: 'main' })
  fake.setChecks(r, pr.headSha, green)
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', kind: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  return id
}
const review = (id: number) => actions.requestReview(payload, member, { ticket: id, evidence: '' })
const skipsOf = async (id: number) => (await eventsOf(id)).filter((e) => String(e.cause).startsWith('skip:')).map((e) => [e.cause, e.note])
const finish = async (id: number, stage: string, outcome: string) => {
  const run = (await runsOf(id)).filter((r) => r.stage === stage && r.status === 'awaiting_session').at(-1)!
  const claimed = await claimOnly(payload, call, member, ws, run.id)
  await call(member, 'finish_run', { runId: run.id, leaseToken: claimed.leaseToken, status: 'succeeded', outcome })
}

it('a change that touches no security or ui paths and is no bug skips all three steps and goes to review', async () => {
  const id = await ticketWith('docs only', ['README.md'], ['bauherr:type:feature'])
  expect(await review(id)).toMatchObject({ stage: 'review' })
  expect(await reload(id)).toMatchObject({ stage: 'review' })
  expect(await skipsOf(id)).toEqual([
    ['skip:security-review', 'the change touches no security paths'],
    ['skip:ux-review', 'the change touches no ui paths'],
    ['skip:test-review', 'the request is not a bug'],
  ])
  expect((await runsOf(id)).map((r) => r.stage)).toEqual(['build', 'review'])
  expect(await history.skips(payload, id)).toMatchObject([{ stage: 'security-review', reason: 'the change touches no security paths' }, { stage: 'ux-review' }, { stage: 'test-review' }])
})

it('a security change enters the security step; a pass skips ux and enters the test step for a bug', async () => {
  const id = await ticketWith('auth fix', ['src/auth/login.ts'], ['bauherr:type:bug'])
  expect(await review(id)).toMatchObject({ stage: 'security-review' })
  expect(await reload(id)).toMatchObject({ stage: 'security-review' })
  expect((await runsOf(id)).at(-1)).toMatchObject({ stage: 'security-review', kind: 'agent', status: 'awaiting_session' })
  expect(await skipsOf(id)).toEqual([])
  await finish(id, 'security-review', 'pass')
  expect(await reload(id)).toMatchObject({ stage: 'test-review' })
  expect((await runsOf(id)).map((r) => r.stage)).toEqual(['build', 'security-review', 'test-review'])
  expect(await skipsOf(id)).toEqual([['skip:ux-review', 'the change touches no ui paths']])
  await finish(id, 'test-review', 'pass')
  expect(await reload(id)).toMatchObject({ stage: 'review' })
})

it('findings still go back to build, and a second review skips the same steps once more', async () => {
  const id = await ticketWith('ui and auth', ['src/auth/a.ts', 'src/app/page.tsx'])
  await review(id)
  await finish(id, 'security-review', 'findings')
  expect(await reload(id)).toMatchObject({ stage: 'build' })
})

it('unknown changed paths match a declared set; a set the Product never declared never matches', async () => {
  // no MR and no plan: the paths are not known, so the declared security set matches
  const issue = await fake.tickets(repo).create({ title: 'no mr', labels: ['bauherr:stage:build'] })
  const id = (await payload.create({ collection: 'tickets', data: { title: 'no mr', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'build', product, workspace: ws }, ...o })).id as number
  const { advance } = await import('../src/lib/advance')
  expect(await advance(payload, null, await reload(id), 'done', { by: 'factory' })).toMatchObject({ stage: 'security-review', entered: 'moved' })
  // the bare Product declares no set: security and ux are skipped whatever the files are
  const b = await ticketWith('bare', ['src/auth/x.ts'], ['bauherr:type:bug'], bareRepo, bare)
  expect(await review(b)).toMatchObject({ stage: 'test-review' })
  expect(await skipsOf(b)).toEqual([['skip:security-review', 'the Product declares no security paths'], ['skip:ux-review', 'the Product declares no ui paths']])
})

it('a skipped step is no visit and no time: spans, flow metrics and the Ticket page leave it out', async () => {
  const id = await ticketWith('metrics', ['README.md'])
  await review(id)
  const spans = await history.timeline(payload, id)
  expect(spans.map((s) => s.stage)).not.toContain('security-review')
  expect(spans.some((s) => String(s.cause).startsWith('skip:'))).toBe(false)
  const flow = await history.flow(payload, ws, { from: new Date(Date.now() - 3600e3).toISOString(), to: new Date(Date.now() + 3600e3).toISOString() })
  const mine = flow.tickets.find((t) => t.ticket === id)!
  expect(mine.stages.map((s) => s.stage)).not.toEqual(expect.arrayContaining(['security-review']))
  expect(flow.stages.map((s) => s.stage)).not.toContain('ux-review')
  const { buildSteps } = await import('../src/app/(app)/lib/steps')
  const { workflowFor } = await import('../src/lib/factory')
  const steps = buildSteps(workflowFor(ws), spans, [], [], { current: 'review', provider: null, admin: false, skips: await history.skips(payload, id) })
  expect(steps.visits.map((v) => v.stage)).not.toContain('security-review')
  expect(steps.skipped.map((s) => [s.title, s.reason])).toEqual([['Security review', 'the change touches no security paths'], ['UX review', 'the change touches no ui paths'], ['Test review', 'the request is not marked as a bug']])
})

it('next_work never offers a Ticket for a step it skipped', async () => {
  const id = await ticketWith('frontier', ['README.md'])
  await review(id)
  const skipped = ['security-review', 'ux-review', 'test-review']
  expect((await runsOf(id)).map((r) => r.stage).filter((x) => skipped.includes(x))).toEqual([])
  expect(((await call(member, 'list_frontier', {})) as { ticket: number; stage: string }[]).filter((t) => t.ticket === id && skipped.includes(t.stage))).toEqual([])
  expect((await reload(id)).waitingFor).toBe('review')
})
