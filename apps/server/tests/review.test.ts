import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let product: number
let ws: number
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const EVIDENCE = 'Closes it\n\n## Evidence\n| Goal | verified |\n'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_review WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_review')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_review')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

/** A review Ticket with an open factory MR and a claimed session Review Run. */
const seed = async (o2: { body?: string; checks?: any[] } = {}) => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title: 'review me', labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'review me', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = `feat-${issue.number}`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 'review me', body: o2.body ?? EVIDENCE, head: branch, base: 'main' })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  if (o2.checks) fake.setChecks(repo, pr.headSha, o2.checks)
  return { t, pr, n: String(issue.number), branch, id: t.id as number }
}
/** Starts and claims the Review Run. */
const review = async (id: number) => {
  const started = await jobs.startReviewIfReady(payload, (await reload(id)) as any)
  const { leaseToken } = await call(member, 'claim_run', { runId: started!.run.id })
  return { runId: started!.run.id as number, leaseToken: leaseToken as string }
}
const submit = (r: { runId: number; leaseToken: string }, findings: any[] = [], markdown = '**Verdict**: x') =>
  call(member, 'submit_review', { ...r, verdict: findings.length ? 'changes' : 'clean', findings, markdown })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const prState = async (n: number) => (await fake.forge.getPullRequest(repo, n)).state
const medium = { severity: 'medium', file: 'a.ts', line: 3, msg: 'off by one', scenario: 'when n is 0, then it returns -1' }

it('clean review + green checks merges with no human touch; watch-release then releases', async () => {
  const { id, pr, branch } = await seed({ checks: green })
  const r = await review(id)
  expect(await submit(r, [{ severity: 'low', file: 'a.ts', line: 1, msg: 'nit', scenario: 's' }])).toMatchObject({ verdict: 'clean', outcome: 'merged' })
  expect(await prState(pr.number)).toBe('merged')
  expect((await fake.forge.listBranches(repo)).some((b) => b.name === branch)).toBe(false)
  expect((await reload(id)).reviewState).toBe('merged')
  expect(await payload.count({ collection: 'human_touches', where: { ticket: { equals: id } }, ...o })).toMatchObject({ totalDocs: 0 })
  expect(await payload.findByID({ collection: 'runs', id: r.runId, ...o })).toMatchObject({ status: 'succeeded', verdict: 'clean' })
  await release.watchRelease(payload)
  expect((await reload(id)).stage).toBe('release')
})

it('clean review + no checks at all counts as green', async () => {
  const { id, pr } = await seed()
  expect(await submit(await review(id))).toMatchObject({ outcome: 'merged' })
  expect(await prState(pr.number)).toBe('merged')
})

it('clean + pending checks waits, then merges once on the next tick', async () => {
  const { id, pr } = await seed({ checks: [{ name: 'ci', status: 'in_progress', conclusion: null }] })
  expect(await submit(await review(id))).toMatchObject({ outcome: 'waiting_checks' })
  expect((await reload(id)).reviewState).toBe('waiting_checks')
  expect(await actions.watchReviews(payload)).toBe(0)
  expect(await prState(pr.number)).toBe('open')
  fake.setChecks(repo, pr.headSha, green)
  const merged = await Promise.all([actions.watchReviews(payload), actions.watchReviews(payload)])
  expect(merged.reduce((a, b) => a + b, 0)).toBe(1)
  expect(await prState(pr.number)).toBe('merged')
  expect((await reload(id)).reviewState).toBe('merged')
})

it('a medium finding goes back to Build on the same MR branch with the findings in the worklog', async () => {
  const { id, pr, n, branch } = await seed({ checks: green })
  const r = await review(id)
  expect(await submit(r, [medium, { severity: 'low', file: 'b.ts', line: 1, msg: 'nit', scenario: 's' }], 'the review')).toMatchObject({ verdict: 'changes', outcome: 'build' })
  expect(await prState(pr.number)).toBe('open')
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, reviewRounds: 1 })
  const build = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, ...o })).docs
  expect(build).toHaveLength(1)
  const worklog = (await actions.readWorklog(payload, member, { ticket: id }))
  expect(worklog).toContain('[medium] a.ts:3 off by one')
  expect(worklog).toContain(`branch \`${branch}\``)
  expect(worklog).toMatch(/\*\*Unfinished work\*\*\n- \[medium\]/)
  expect((await fake.tickets(repo).get(n)).labels).toContain('bauherr:stage:build')
  const t = await call(member, 'get_ticket', { ticket: id })
  expect(t.pr).toMatchObject({ number: pr.number, branch })
  expect((await fake.forge.listPullRequests(repo)).filter((p) => p.head === branch)).toHaveLength(1)
})

it('the 3rd return to Build needs a human', async () => {
  const { id, n } = await seed({ checks: green })
  for (const round of [1, 2]) {
    expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'build' })
    expect((await reload(id)).reviewRounds).toBe(round)
    await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  }
  expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'needs_human' })
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', reviewRounds: 3 })
  expect((await fake.tickets(repo).listComments(n)).some((c) => c.body.startsWith('Bauherr needs a human: the review found 1 blocking'))).toBe(true)
  expect(await jobs.startReviewIfReady(payload, await reload(id))).toBeNull()
})

it('autoMerge off leaves a ready-to-merge comment and no merge', async () => {
  const { id, pr, n } = await seed({ checks: green })
  await payload.update({ collection: 'products', id: product, data: { autoMerge: false }, ...o })
  try {
    expect(await submit(await review(id))).toMatchObject({ outcome: 'ready_for_human' })
  } finally {
    await payload.update({ collection: 'products', id: product, data: { autoMerge: true }, ...o })
  }
  expect(await prState(pr.number)).toBe('open')
  expect((await reload(id)).reviewState).toBe('ready_for_human')
  expect((await fake.tickets(repo).listComments(n)).some((c) => c.body.includes('ready to merge by a human'))).toBe(true)
})

it('a clean MR without ## Evidence is handed to a human, not merged', async () => {
  const { id, pr } = await seed({ checks: green, body: 'no evidence here' })
  expect(await submit(await review(id))).toMatchObject({ outcome: 'ready_for_human' })
  expect(await prState(pr.number)).toBe('open')
})

it('red checks go back to Build with the failing check names and count as a round', async () => {
  const { id, pr } = await seed({ checks: [{ name: 'ci', status: 'completed', conclusion: 'failure' }, { name: 'lint', status: 'completed', conclusion: 'success' }] })
  expect(await submit(await review(id))).toMatchObject({ verdict: 'clean', outcome: 'build' })
  expect(await prState(pr.number)).toBe('open')
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, reviewRounds: 1 })
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('check `ci` is red')
})

it('submit_review is refused without the lease and on a non-review Run', async () => {
  const { id, pr } = await seed({ checks: green })
  const r = await review(id)
  const body = { runId: r.runId, verdict: 'clean', findings: [], markdown: 'm' }
  await expect(call(member, 'submit_review', body)).rejects.toThrow('leased by another session')
  await expect(call(member, 'submit_review', { ...body, leaseToken: 'x'.repeat(43) })).rejects.toThrow('leased by another session')
  expect(await prState(pr.number)).toBe('open')
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).status).toBe('running')
  await expect(call(member, 'submit_review', { ...r, verdict: 'clean', findings: [{ severity: 'high' }], markdown: 'm' })).rejects.toThrow('finding 0')
  await expect(submit(r)).resolves.toMatchObject({ outcome: 'merged' })
  await expect(submit(r)).rejects.toThrow('lease lost')
})
