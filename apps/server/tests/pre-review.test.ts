import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { reviewRoundStats } from '../scripts/review-rounds'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const RULES = { tests: [{ src: ['src/**'], tests: ['tests/**'] }] }

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('pre_review')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  for (const pr of await fake.forge.listPullRequests(repo, 'open')) await fake.forge.closePullRequest(repo, pr.number)
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: RULES }, ...o })
})

/** A claimed session build Run on Ticket #1 and an open factory MR holding `files`. */
const seed = async (files: Record<string, string>) => {
  const ticket = await payload.create({ collection: 'tickets', data: { title: 't', externalId: `p-${++n}`, number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  const head = `bauherr/1-${n}`
  await fake.forge.createBranch(repo, head)
  for (const [path, content] of Object.entries(files)) fake.commit(repo, head, path, content)
  const pr = await fake.forge.openPullRequest(repo, { title: 't', body: 'b', head, base: 'main' })
  return { ticket, run, a: { runId: run.id, leaseToken }, pr }
}
const stage = async (id: number) => ((await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>).stage
const STEPS = '| Plan step | done/deferred | Evidence or reason |\n|---|---|---|\n| 1 | done | x |\n| 2 | deferred | later |'

it('request_review is refused while a rule fails, leaves the Ticket in build, and passes once satisfied', async () => {
  const { ticket, a, pr } = await seed({ 'src/a.ts': 'x' })
  await expect(call(member, 'request_review', a)).rejects.toThrow('Pre-review checks failed:\n- src/a.ts changed but no file matching tests/** did')
  expect(await stage(ticket.id as number)).toBe('build')
  const failures = (await call(member, 'run_checks', a)).failures
  expect(failures).toHaveLength(1)
  await fake.forge.closePullRequest(repo, pr.number)
  const fixed = await seed({ 'src/a.ts': 'x', 'tests/a.test.ts': 'y' })
  expect((await call(member, 'run_checks', fixed.a)).failures).toEqual([])
  await expect(call(member, 'request_review', fixed.a)).resolves.toMatchObject({ stage: 'review' })
  expect(await stage(fixed.ticket.id as number)).toBe('review')
})

it('request_review passes with the rules off', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: null }, ...o })
  const { a } = await seed({ 'src/a.ts': 'x' })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
})

it('finish_run with an MR enforces the same checks and keeps the Run running', async () => {
  const { ticket, run, a, pr } = await seed({ 'src/a.ts': 'x' })
  await expect(call(member, 'finish_run', { ...a, status: 'succeeded', prUrl: pr.url })).rejects.toThrow('Pre-review checks failed')
  expect(await stage(ticket.id as number)).toBe('build')
  expect((await payload.findByID({ collection: 'runs', id: run.id, ...o })).status).toBe('running')
})

it('the evidence rule needs a done/deferred row per plan step and the named test files must exist', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: { ...RULES, evidence: true } }, ...o })
  const { a } = await seed({ 'src/a.ts': 'x', 'tests/a.test.ts': 'y' })
  await expect(call(member, 'request_review', a)).rejects.toThrow('no done/deferred row for plan step 1')
  await call(member, 'attach_evidence', { ...a, markdown: `${STEPS}\nran tests/missing.test.ts` })
  await expect(call(member, 'request_review', a)).rejects.toThrow('tests/missing.test.ts, which does not exist')
  await call(member, 'attach_evidence', { ...a, markdown: 'ran tests/a.test.ts' })
  await payload.update({ collection: 'runs', id: a.runId, data: { evidence: `${STEPS}\nran tests/a.test.ts` }, ...o })
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
})

it('a truncated tree makes file existence unknown, so named test files are not reported missing', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: RULES }, ...o })
  const { a } = await seed({ 'src/a.ts': 'x', 'tests/a.test.ts': 'y' })
  await call(member, 'attach_evidence', { ...a, markdown: 'ran tests/missing.test.ts' })
  await expect(call(member, 'request_review', a)).rejects.toThrow('tests/missing.test.ts, which does not exist')
  const list = fake.forge.listFiles
  vi.spyOn(fake.forge, 'listFiles').mockImplementation(async (r, ref) => ({ ...(await list(r, ref)), truncated: true }))
  try {
    expect((await call(member, 'run_checks', a)).failures).toEqual([])
  } finally {
    vi.restoreAllMocks()
  }
})

it('review-rounds splits merged Tickets at the cutoff', () => {
  const rows = [
    { reviewRounds: 2, releaseAt: '2026-10-30T00:00:00Z' },
    { reviewRounds: 1, releaseAt: '2026-10-31T00:00:00Z' },
    { reviewRounds: 0, releaseAt: '2026-10-31T00:00:00Z' },
    { reviewRounds: 4, releaseAt: '2026-11-06T00:00:00Z' },
    { reviewRounds: 9, releaseAt: null },
  ]
  expect(reviewRoundStats(rows, '2026-11-05')).toEqual({
    before: { tickets: 3, rounds: 3, mean: 1, median: 1 },
    after: { tickets: 1, rounds: 4, mean: 4, median: 4 },
  })
  expect(reviewRoundStats([], '2026-11-05').before).toEqual({ tickets: 0, rounds: 0, mean: null, median: null })
})

it('a docs Ticket whose MR changes a path outside the docs paths is refused, naming them', async () => {
  await payload.update({ collection: 'products', id: product, data: { reviewChecks: null, docsCheck: { paths: ['README.md', 'docs/**/*.md'] } }, ...o })
  const { ticket, a, pr } = await seed({ 'docs/a.md': 'x', 'src/b.ts': 'y' })
  await payload.update({ collection: 'tickets', id: ticket.id, data: { labels: ['bauherr:docs'] }, ...o })
  await expect(call(member, 'request_review', a)).rejects.toThrow("docs Ticket: src/b.ts outside the Product's docs paths")
  expect(await stage(ticket.id as number)).toBe('build')
  await fake.forge.closePullRequest(repo, pr.number)
  const ok = await seed({ 'docs/a.md': 'x', 'README.md': 'y' })
  await payload.update({ collection: 'tickets', id: ok.ticket.id, data: { labels: ['bauherr:docs'] }, ...o })
  expect((await call(member, 'run_checks', ok.a)).failures).toEqual([])
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const UI_RULE = 'UI change: before/after'
const VARIANTS = ['light-desktop', 'dark-desktop']
const uiProduct = (pathSets: Record<string, string[]> | null) => payload.update({ collection: 'products', id: product, data: { reviewChecks: null, pathSets }, ...o })
const shoot = (a: object, variant: string, pair: 'before' | 'after') => call(member, 'attach_artifact', { ...a, kind: 'image', rule: UI_RULE, pair, title: `${variant}: Settings ${pair}`, file: { name: 'a.png', base64: PNG } })
const UI_FILES = { 'src/ui/a.tsx': 'x' }
/** Earlier tests leave Tickets in review; the WIP limit would keep the next one in build. */
const emptyReview = () => payload.update({ collection: 'tickets', where: { stage: { equals: 'review' } }, data: { stage: 'done' }, ...o })

it('a ui diff is refused without the light and dark before/after pair, naming what is missing', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { ticket, a } = await seed(UI_FILES)
  await expect(call(member, 'request_review', a)).rejects.toThrow(`No before/after pair "${UI_RULE}" on the pushed head, missing: light-desktop before, light-desktop after, dark-desktop before, dark-desktop after`)
  expect(await stage(ticket.id as number)).toBe('build')
  await shoot(a, 'light-desktop', 'before')
  await shoot(a, 'light-desktop', 'after')
  await shoot(a, 'dark-desktop', 'before')
  await expect(call(member, 'run_checks', a)).resolves.toMatchObject({ failures: [expect.stringContaining('missing: dark-desktop after')] })
})

it('a ui diff passes once every variant has a before and an after image on the head', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { a } = await seed(UI_FILES)
  for (const v of VARIANTS) for (const p of ['before', 'after'] as const) await shoot(a, v, p)
  expect((await call(member, 'run_checks', a)).failures).toEqual([])
  await emptyReview()
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
})

it('only kind=image proof with a pair counts: a report or an unpaired image does not', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { a } = await seed(UI_FILES)
  for (const v of VARIANTS) {
    await call(member, 'attach_artifact', { ...a, kind: 'report', rule: UI_RULE, title: `${v}: before`, text: 'ok' })
    await call(member, 'attach_artifact', { ...a, kind: 'image', rule: UI_RULE, title: `${v}: shot`, file: { name: 'a.png', base64: PNG } })
  }
  expect((await call(member, 'run_checks', a)).failures[0]).toContain('missing: light-desktop before')
})

it('pair images of an older head do not count after a new push', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { a, pr } = await seed(UI_FILES)
  for (const v of VARIANTS) for (const p of ['before', 'after'] as const) await shoot(a, v, p)
  expect((await call(member, 'run_checks', a)).failures).toEqual([])
  fake.commit(repo, pr.head, 'src/ui/b.tsx', 'y')
  expect((await call(member, 'run_checks', a)).failures[0]).toContain('missing: light-desktop before')
})

it('"No artifact: UI change: before/after: <reason>" passes and the reason reaches the proof list', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { ticket, a } = await seed(UI_FILES)
  await call(member, 'attach_evidence', { ...a, markdown: `No artifact: ${UI_RULE}: copy change only, nothing to shoot` })
  await emptyReview()
  await expect(call(member, 'request_review', a)).resolves.toMatchObject({ stage: 'review' })
  const waiver = (await payload.find({ collection: 'artifacts', where: { and: [{ ticket: { equals: ticket.id } }, { waived: { equals: true } }] }, ...o })).docs[0]
  expect(waiver).toMatchObject({ rule: UI_RULE, text: 'copy change only, nothing to shoot' })
  const { loadProof } = await import('../src/app/(app)/lib/proof')
  const doc = (await payload.findByID({ collection: 'products', id: product, depth: 0, ...o })) as Record<string, any>
  const shown = (await loadProof(payload, [await payload.findByID({ collection: 'tickets', id: ticket.id, depth: 0, ...o })], new Map([[product, doc]]))).get(ticket.id as number)
  expect(shown?.waived).toEqual([{ rule: UI_RULE, reason: 'copy change only, nothing to shoot' }])
})

it('a line for another rule or a malformed one does not waive the ui rule', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { a } = await seed(UI_FILES)
  for (const markdown of ['No artifact: UI change: no reason given:', 'No artifact: Other: because', `No artifact: ${UI_RULE}`, `No artifact: ${UI_RULE}:   `]) {
    await call(member, 'attach_evidence', { ...a, markdown })
    expect((await call(member, 'run_checks', a)).failures[0]).toContain('No before/after pair')
  }
})

it('a diff outside the ui paths is not affected', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { a } = await seed({ 'src/api/a.ts': 'x' })
  expect((await call(member, 'run_checks', a)).failures).toEqual([])
})

it('a Product without a ui path set (or with an empty one) gets no rule', async () => {
  for (const sets of [null, { security: ['src/auth/**'] }, { ui: [] }] as (Record<string, string[]> | null)[]) {
    await uiProduct(sets)
    const { a, pr } = await seed(UI_FILES)
    expect((await call(member, 'run_checks', a)).failures).toEqual([])
    await fake.forge.closePullRequest(repo, pr.number)
  }
})

it('attaching the same pair image again (a retry) stores one row', async () => {
  await uiProduct({ ui: ['src/ui/**'] })
  const { ticket, a } = await seed(UI_FILES)
  const first = await shoot(a, 'light-desktop', 'before')
  const again = await shoot(a, 'light-desktop', 'before')
  expect(again).toMatchObject({ created: false, artifact: first.artifact })
  const other = await shoot(a, 'dark-desktop', 'before')
  expect(other.created).not.toBe(false)
  expect((await payload.find({ collection: 'artifacts', where: { ticket: { equals: ticket.id } }, ...o })).totalDocs).toBe(2)
})
