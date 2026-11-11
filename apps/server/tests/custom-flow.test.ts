import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The default flow with a custom `agent` stage (security) and a `human` stage (signoff) between build and review (fixtures/custom-pack). The shipped skill security-scan does not fit (it works on scan Runs), so the fixture has its own minimal security-review skill. */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let member: Record<string, any>
let agent: { kind: 'agent'; keyId: number | string }
let call: (user: any, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let release: typeof import('../src/lib/release')
let wip: typeof import('../src/lib/wip')
const o = { overrideAccess: true } as const
const repo = 'acme/custom'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/custom-pack', import.meta.url))
  testDb = await createTestDb('custom_flow')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  jobs = await import('../src/jobs')
  wip = await import('../src/lib/wip')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: user.actor ?? { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, gateOwners: 'owner', stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const keys = await import('../src/lib/api-key')
  agent = { kind: 'agent', keyId: (await keys.resolveAgentKey(payload, await keys.mintAgentKey(payload, member as { id: number }, 'laptop')))!.keyId }
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: 'createdAt', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]
const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const labelsOf = async (n: string) => (await fake.tickets(repo).get(n)).labels
const claim = async (ticket: number, stage: string) => {
  const run = (await runsOf(ticket)).filter((r) => r.stage === stage && r.status === 'awaiting_session').at(-1)!
  const claimed = await claimOnly(payload, call, member, ws, run.id)
  return { runId: run.id as number, leaseToken: claimed.leaseToken as string, claimed }
}
const runShape = async (id: number) => (await runsOf(id)).map((r) => [r.stage, r.kind, r.outcome ?? null])
const checked = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'].map((area) => ({ area, note: `checked ${area}` }))
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const mrFor = async (number: number) => {
  const head = `bauherr/${number}-feat`
  if (!(await fake.forge.listBranches(repo)).some((b) => b.name === head)) await fake.forge.createBranch(repo, head)
  fake.commit(repo, head, 'a.ts', `x${Math.random()}`)
  const pr = (await fake.forge.listPullRequests(repo)).find((p) => p.head === head && p.state === 'open') ?? (await fake.forge.openPullRequest(repo, { title: 'custom flow', body: 'Done\n\n## Evidence\n| Goal | verified |\n', head, base: 'main' }))
  fake.setChecks(repo, pr.headSha, green)
  return pr
}

it('a Ticket goes through an agent stage and a human stage on its way to review', async () => {
  const { DEFAULT, order } = await import('../src/lib/workflow')
  expect(order(DEFAULT())).toEqual(['triage', 'plan', 'parent', 'build', 'security', 'signoff', 'review', 'release', 'done'])
  const issue = await fake.tickets(repo).create({ title: 'custom flow' })
  const n = String(issue.number)
  await poll()
  const id = ((await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>).id as number

  const triage = await claim(id, 'triage')
  await call(member, 'submit_triage', { runId: triage.runId, leaseToken: triage.leaseToken, outcome: 'plan', reason: 'clear' })
  await poll()
  const plan = await claim(id, 'plan')
  await call(member, 'submit_plan', { runId: plan.runId, leaseToken: plan.leaseToken, markdown: '## TL;DR\nDecision: build it\nRecommendation: yes\nWhy:\n- small\nRisk: none\n\n## Goal\ncustom' })
  await call(member, 'finish_run', { runId: plan.runId, leaseToken: plan.leaseToken, status: 'succeeded' })
  await poll()
  expect(await reload(id)).toMatchObject({ stage: 'build' })

  // build asks for review: the Ticket lands in `security`, with an agent Run
  const build1 = await claim(id, 'build')
  const pr = await mrFor(issue.number)
  await call(member, 'finish_run', { runId: build1.runId, leaseToken: build1.leaseToken, status: 'succeeded', prUrl: pr.url })
  expect(await reload(id)).toMatchObject({ stage: 'security' })
  expect(await labelsOf(n)).toContain('bauherr:stage:security')
  expect((await runsOf(id)).at(-1)).toMatchObject({ stage: 'security', kind: 'agent', status: 'awaiting_session' })

  // the session gets the stage's skill, the role profile and the outcome keys; it has no way to review or approve
  const sec1 = await claim(id, 'security')
  expect(sec1.claimed.agent).toMatchObject({ stage: 'security', title: 'Security review', skill: 'security-review', outcomes: ['pass', 'findings', 'unclear'], role: { id: 'security', profile: expect.stringContaining('security problems') } })
  await expect(call(member, 'submit_review', { runId: sec1.runId, leaseToken: sec1.leaseToken, verdict: 'clean', findings: [], checked, markdown: 'x' })).rejects.toThrow(/not a review Run/)
  await expect(call(member, 'request_review', { runId: sec1.runId, leaseToken: sec1.leaseToken })).rejects.toThrow(/agent stage/)
  await expect(call(member, 'finish_run', { runId: sec1.runId, leaseToken: sec1.leaseToken, status: 'succeeded' })).rejects.toThrow(/outcome must be one of pass, findings, unclear/)
  await expect(call(member, 'finish_run', { runId: sec1.runId, leaseToken: sec1.leaseToken, status: 'succeeded', outcome: 'maybe' })).rejects.toThrow(/outcome must be one of/)
  await expect(call(member, 'finish_run', { runId: sec1.runId, leaseToken: sec1.leaseToken, status: 'succeeded', outcome: 'pass', prUrl: pr.url })).rejects.toThrow(/cannot link an MR/)

  // findings: back to Build on the same MR, with the comment, no review round
  await call(member, 'finish_run', { runId: sec1.runId, leaseToken: sec1.leaseToken, status: 'succeeded', outcome: 'findings', comment: 'SQL injection in a.ts line 3' })
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewRounds: 0 })
  expect(await labelsOf(n)).toContain('bauherr:stage:build')
  expect((await fake.tickets(repo).listComments(n)).some((c) => c.body === '<!-- bauherr:stage:security -->\nSQL injection in a.ts line 3')).toBe(true)
  expect(await runShape(id)).toEqual([['triage', 'triage', null], ['plan', 'plan', null], ['build', 'build', null], ['security', 'agent', 'findings'], ['build', 'build', null]])

  // build again, security passes: the Ticket waits in `signoff` for a person
  const build2 = await claim(id, 'build')
  await mrFor(issue.number)
  await call(member, 'finish_run', { runId: build2.runId, leaseToken: build2.leaseToken, status: 'succeeded', prUrl: pr.url })
  expect(await reload(id)).toMatchObject({ stage: 'security' })
  const sec2 = await claim(id, 'security')
  await call(member, 'finish_run', { runId: sec2.runId, leaseToken: sec2.leaseToken, status: 'succeeded', outcome: 'pass' })
  const signoff = await reload(id)
  expect(signoff).toMatchObject({ stage: 'signoff' })
  expect((await runsOf(id)).filter((r) => r.stage === 'signoff')).toHaveLength(0)
  const { workflowFor } = await import('../src/lib/factory')
  const { needsOf } = await import('../src/lib/needs-you')
  expect(needsOf(workflowFor(ws), signoff, (await runsOf(id)).at(-1) as any, false)).toBe('Decision needed')
  await expect(call({ ...member, actor: agent }, 'decide', { ticket: id, outcome: 'approve' })).rejects.toThrow('forbidden: decide needs a human')
  await expect(call(member, 'decide', { ticket: id, outcome: 'maybe' })).rejects.toThrow(/outcome must be one of approve, reject/)

  // the person approves: review, clean verdict, merge, staging, done
  await call(member, 'decide', { ticket: id, outcome: 'approve' })
  expect(await reload(id)).toMatchObject({ stage: 'review' })
  expect(await labelsOf(n)).toContain('bauherr:stage:review')
  const review = await claim(id, 'review')
  expect(await call(member, 'submit_review', { runId: review.runId, leaseToken: review.leaseToken, verdict: 'clean', findings: [], checked, markdown: 'clean' })).toMatchObject({ verdict: 'clean', outcome: 'merged' })
  expect(await release.watchRelease(payload)).toMatchObject({ released: 1 })
  expect(await reload(id)).toMatchObject({ stage: 'release' })
  fake.setChecks(repo, (await reload(id)).mergeSha, green)
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await reload(id)).toMatchObject({ stage: 'done', state: 'closed' })

  expect(await runShape(id)).toEqual([['triage', 'triage', null], ['plan', 'plan', null], ['build', 'build', null], ['security', 'agent', 'findings'], ['build', 'build', null], ['security', 'agent', 'pass'], ['review', 'review', null]])
  const touches = (await payload.find({ collection: 'human_touches', where: { ticket: { equals: id } }, pagination: false, ...o })).docs as Record<string, any>[]
  expect(touches.map((t) => t.kind)).toContain('decide:signoff:approve')
  expect(touches.find((t) => t.kind === 'decide:signoff:approve')!.actor).toBe('m@x.io')
  const events = (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: id } }, sort: 'at', pagination: false, depth: 0, ...o })).docs as Record<string, any>[]
  const path = events.map((e) => e.stage).filter((s, i, all) => s !== all[i - 1])
  expect(path).toEqual(['triage', 'plan', 'build', 'security', 'build', 'security', 'signoff', 'review', 'release', 'done'])
  expect(events.find((e) => e.stage === 'signoff')).toMatchObject({ phase: 'human', stageKind: 'human' })
  expect(events.filter((e) => e.stage === 'security').map((e) => e.stageKind)).toEqual(expect.arrayContaining(['agent']))
})

it('WIP on the custom stage holds a second Ticket until the first leaves', async () => {
  const seed = async (title: string, stage: string) => {
    const issue = await fake.tickets(repo).create({ title, labels: [`bauherr:stage:${stage}`] })
    return (await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, product, workspace: ws }, ...o })).id as number
  }
  const occupant = await seed('in security', 'security')
  const waiter = await seed('wants security', 'build')
  await mrFor((await reload(waiter)).number)
  const actions = await import('../src/lib/actions')
  expect(await actions.requestReview(payload, member, { ticket: waiter, evidence: '' })).toMatchObject({ waiting: 'security' })
  expect(await reload(waiter)).toMatchObject({ stage: 'build', waitingFor: 'security' })
  expect(await wip.wipCount(payload, ws, 'security')).toBe(1)
  await payload.update({ collection: 'tickets', id: occupant, data: { state: 'closed', stage: 'done' }, ...o })
  expect(await wip.pullWaiting(payload)).toBe(1)
  expect(await reload(waiter)).toMatchObject({ stage: 'security', waitingFor: null })
  expect((await runsOf(waiter)).at(-1)).toMatchObject({ stage: 'security', kind: 'agent' })
})
