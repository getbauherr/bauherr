import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DEFAULT } from '../src/lib/workflow'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The default factory with every stage renamed (fixtures/renamed-pack): triage=intake, plan=design, parent=epic, build=code, review=check, release=ship, done=shipped. Built-in behaviour binds to the stage kind, so the flow must not notice. */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let member: Record<string, any>
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
let wip: typeof import('../src/lib/wip')
let needs: typeof import('../src/app/(app)/lib/needs-you')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/renamed-pack', import.meta.url))
  testDb = await createTestDb('renamed_flow')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  wip = await import('../src/lib/wip')
  needs = await import('../src/app/(app)/lib/needs-you')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: 'createdAt', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]

it('the renamed pack is the workflow in use', async () => {
  const { DEFAULT, order } = await import('../src/lib/workflow')
  expect(order(DEFAULT())).toEqual(['intake', 'design', 'epic', 'code', 'check', 'ship', 'shipped'])
})

it('a built Ticket in check merges into ship, staging confirms and it closes as shipped', async () => {
  const issue = await fake.tickets(repo).create({ title: 'ship me', labels: ['bauherr:stage:check'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'ship me', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'check', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, branch)
  const pr = await fake.forge.openPullRequest(repo, { title: 'ship me', head: branch, base: 'main' })
  const build = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'code', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  expect(build).toMatchObject({ stage: 'code', kind: 'build' })

  const sha = fake.merge(repo, pr.number)
  expect(await release.watchRelease(payload)).toMatchObject({ released: 1 })
  expect(await reload(t.id as number)).toMatchObject({ stage: 'ship', mergeSha: sha, releaseState: 'waiting' })
  expect((await fake.tickets(repo).get(String(issue.number))).labels).toContain('bauherr:stage:ship')
  expect(await wip.wipCount(payload, ws, 'ship')).toBe(1)
  expect(await wip.wipCount(payload, ws, 'check')).toBe(0)
  expect(needs.releaseWord(DEFAULT(), await reload(t.id as number))).toBe('waiting')

  fake.setChecks(repo, sha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await reload(t.id as number)).toMatchObject({ stage: 'shipped', state: 'closed' })
  expect((await fake.tickets(repo).get(String(issue.number))).labels).toContain('bauherr:stage:shipped')
  expect((await runsOf(t.id as number)).map((r) => [r.stage, r.kind])).toEqual([['code', 'build']])
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const labelsOf = async (n: string) => (await fake.tickets(repo).get(n)).labels
const claim = async (ticket: number, stage: string) => {
  const run = (await runsOf(ticket)).filter((r) => r.stage === stage).at(-1)!
  const { leaseToken } = await claimOnly(payload, call, member, ws, run.id)
  return { runId: run.id as number, leaseToken: leaseToken as string }
}
const kinds = async (ticket: number) => (await runsOf(ticket)).map((r) => [r.stage, r.kind])
const checked = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'].map((area) => ({ area, note: `checked ${area}` }))
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]

it('one Ticket goes through the whole renamed flow', async () => {
  const issue = await fake.tickets(repo).create({ title: 'renamed flow' })
  const n = String(issue.number)
  await poll()
  const id = ((await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>).id as number

  // triage -> design
  expect(await runsOf(id)).toMatchObject([{ stage: 'intake', kind: 'triage' }])
  const triage = await claim(id, 'intake')
  expect(await call(member, 'submit_triage', { ...triage, outcome: 'plan', reason: 'clear' })).toEqual({ outcome: 'plan' })
  expect(await labelsOf(n)).toContain('bauherr:stage:design')
  await poll()
  expect(await reload(id)).toMatchObject({ stage: 'design' })
  expect(await kinds(id)).toEqual([['intake', 'triage'], ['design', 'plan']])

  // design -> code
  const plan = await claim(id, 'design')
  await call(member, 'submit_plan', { ...plan, markdown: '## TL;DR\nDecision: d\nRecommendation: r\nWhy:\n- w\nRisk: none\n\n## Goal\nrename everything' })
  await call(member, 'finish_run', { ...plan, status: 'succeeded' })
  await poll()
  expect(await reload(id)).toMatchObject({ stage: 'code' })
  expect(await labelsOf(n)).toContain('bauherr:stage:code')
  expect(await kinds(id)).toEqual([['intake', 'triage'], ['design', 'plan'], ['code', 'build']])

  // code -> check
  const mrFor = async () => {
    const head = `bauherr/${issue.number}-feat`
    if (!(await fake.forge.listBranches(repo)).some((b) => b.name === head)) await fake.forge.createBranch(repo, head)
    fake.commit(repo, head, 'a.ts', `x${Math.random()}`)
    return (await fake.forge.listPullRequests(repo)).find((p) => p.head === head && p.state === 'open') ?? (await fake.forge.openPullRequest(repo, { title: 'renamed flow', body: 'Done\n\n## Evidence\n| Goal | verified |\n', head, base: 'main' }))
  }
  const build1 = await claim(id, 'code')
  const pr = await mrFor()
  fake.setChecks(repo, pr.headSha, green)
  await call(member, 'finish_run', { ...build1, status: 'succeeded', prUrl: pr.url })
  expect(await reload(id)).toMatchObject({ stage: 'check' })
  expect(await labelsOf(n)).toContain('bauherr:stage:check')
  expect((await runsOf(id)).at(-1)).toMatchObject({ stage: 'check', kind: 'review', status: 'awaiting_session' })

  // a review with changes returns to code and counts a round
  const review1 = await claim(id, 'check')
  expect(await call(member, 'submit_review', { ...review1, verdict: 'changes', findings: [{ severity: 'medium', class: 'security', file: 'a.ts', line: 3, msg: 'off by one', scenario: 'when n is 0, then it returns -1' }], checked, markdown: 'the review' })).toMatchObject({ verdict: 'changes', outcome: 'build' })
  expect(await reload(id)).toMatchObject({ stage: 'code', reviewRounds: 1 })
  expect(await labelsOf(n)).toContain('bauherr:stage:code')

  // second round: clean review merges
  const build2 = await claim(id, 'code')
  const pr2 = await mrFor()
  fake.setChecks(repo, pr2.headSha, green)
  await call(member, 'finish_run', { ...build2, status: 'succeeded', prUrl: pr2.url })
  const review2 = await claim(id, 'check')
  expect(await call(member, 'submit_review', { ...review2, verdict: 'clean', findings: [], checked, markdown: 'clean' })).toMatchObject({ verdict: 'clean', outcome: 'merged' })

  // check -> ship -> shipped
  expect(await release.watchRelease(payload)).toMatchObject({ released: 1 })
  expect(await reload(id)).toMatchObject({ stage: 'ship', releaseState: 'waiting' })
  expect(await labelsOf(n)).toContain('bauherr:stage:ship')
  fake.setChecks(repo, (await reload(id)).mergeSha, green)
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await reload(id)).toMatchObject({ stage: 'shipped', state: 'closed' })
  expect(await labelsOf(n)).toContain('bauherr:stage:shipped')
  expect(await kinds(id)).toEqual([['intake', 'triage'], ['design', 'plan'], ['code', 'build'], ['check', 'review'], ['code', 'build'], ['check', 'review']])
})

it('WIP limits are keyed by the renamed stages and hold a Ticket entering a full column', async () => {
  const { DEFAULT, defaultWip, wipStages } = await import('../src/lib/workflow')
  const { wipLimitsError } = await import('../src/lib/wip-limits')
  expect(defaultWip(DEFAULT())).toEqual({ design: 3, code: 2, check: 3, ship: 5 })
  expect(wipStages(DEFAULT())).toEqual(['design', 'code', 'check', 'ship'])
  expect(wipLimitsError({ check: 1 })).toBeNull()
  expect(wipLimitsError({ review: 1 })).toBe('unknown column review')
  await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: { check: 1 } }, ...o })
  const seed = async (title: string, stage: string) => {
    const issue = await fake.tickets(repo).create({ title, labels: [`bauherr:stage:${stage}`] })
    return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws }, ...o })).id as number
  }
  const occupant = await seed('occupies check', 'check')
  const waiter = await seed('wants check', 'code')
  expect(await wip.wipCount(payload, ws, 'check')).toBe(1)
  expect(await actions.requestReview(payload, member, { ticket: waiter, evidence: '' })).toMatchObject({ waiting: 'check' })
  expect(await reload(waiter)).toMatchObject({ stage: 'code', waitingFor: 'check' })
  expect(await wip.wipCount(payload, ws, 'check')).toBe(1)
  expect(await wip.waitingLabel(payload, await reload(waiter))).toBe('Waiting: Check is full (1/1)')
  await payload.update({ collection: 'tickets', id: occupant, data: { state: 'closed', stage: 'shipped' }, ...o })
  expect(await wip.pullWaiting(payload)).toBe(1)
  expect(await reload(waiter)).toMatchObject({ stage: 'check', waitingFor: null })
  expect(await wip.wipCount(payload, ws, 'check')).toBe(1)
  await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: {} }, ...o })
})
