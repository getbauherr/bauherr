import { MergePendingError, type FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

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

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('review')
  process.env.DATABASE_URL = testDb.url
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
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** A review Ticket with an open factory MR and a claimed session Review Run. */
const seed = async (o2: { body?: string; checks?: any[] } = {}) => {
  const ts = fake.tickets(repo)
  const issue = await ts.create({ title: 'review me', labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'review me', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-feat`
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
const checked = ['correctness', 'over-engineering', 'spec-vs-plan', 'evidence'].map((area) => ({ area, note: `checked ${area}` }))
const submit = (r: { runId: number; leaseToken: string }, findings: any[] = [], markdown = '**Verdict**: x', extra: Record<string, unknown> = {}) =>
  call(member, 'submit_review', { ...r, verdict: findings.some((f) => f.severity !== 'low') ? 'changes' : 'clean', findings, checked, markdown, ...extra })
const comments = async (n: string) => (await fake.tickets(repo).listComments(n)).map((c) => c.body)
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

it('a review round only touches Current instructions, Unfinished work and Open; findings appear once', async () => {
  const { id, n } = await seed({ checks: green })
  const kept = '**Goal**\n- [ ] g1\n\n'
  const rest = '**Owners**\n| Item / lane | Owner (Run or person) | Paths |\n| lane | Run 5 | a.ts |\n\n'
  const tail = '**Decisions**\n- 2026-11-01 Use X. Consequence: Y. By: plan.\n\n**Affected Tickets**\n- #9 blocked'
  await fake.tickets(repo).comment(n, `<!-- bauherr:worklog -->\n## Worklog\n${kept}**Current instructions**\nold\n\n${rest}**Unfinished work**\n- item\n\n**Open**\n-\n\n${tail}`)
  const low = { severity: 'low', file: 'b.ts', line: 1, msg: 'nit', scenario: 's' }
  for (const round of [1, 2]) {
    expect(await submit(await review(id), [medium, low])).toMatchObject({ outcome: 'build' })
    await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
    const w = await actions.readWorklog(payload, member, { ticket: id })
    expect(w).toContain('**Goal**\n- [ ] g1')
    expect(w).toContain('**Owners**\n| Item / lane | Owner (Run or person) | Paths |\n| lane | Run 5 | a.ts |\n\n**Unfinished work**')
    expect(w).toContain('**Decisions**\n- 2026-11-01 Use X. Consequence: Y. By: plan.\n\n**Affected Tickets**\n- #9 blocked')
    expect(w).toContain(`Review round ${round}:`)
    expect(w.match(/\[medium\] a\.ts:3/g)).toHaveLength(1)
    expect(w.match(/\[low\] b\.ts:1/g)).toHaveLength(1)
    expect(w).toMatch(/\*\*Unfinished work\*\*\n- item\n- \[medium\][^\n]*\n\n\*\*Open\*\*/)
    expect(w).toMatch(/\*\*Open\*\*\n- \[low\][^\n]*\n\n\*\*Decisions/)
    expect(w.match(/Review round/g)).toHaveLength(1)
  }
})

it('the 3rd return is granted by the factory, the 4th needs a human', async () => {
  const { id, n } = await seed({ checks: green })
  for (const round of [1, 2]) {
    expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'build' })
    expect((await reload(id)).reviewRounds).toBe(round)
    await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  }
  expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'build' })
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
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
  const body = { runId: r.runId, verdict: 'clean', findings: [], checked, markdown: 'm' }
  await expect(call(member, 'submit_review', body)).rejects.toThrow('leased by another session')
  await expect(call(member, 'submit_review', { ...body, leaseToken: 'x'.repeat(43) })).rejects.toThrow('leased by another session')
  expect(await prState(pr.number)).toBe('open')
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).status).toBe('running')
  await expect(call(member, 'submit_review', { ...r, verdict: 'clean', findings: [{ severity: 'high' }], checked, markdown: 'm' })).rejects.toThrow('finding 0')
  await expect(submit(r)).resolves.toMatchObject({ outcome: 'merged' })
  await expect(submit(r)).rejects.toThrow('lease lost')
})

const blocker = (n: number) => ({ severity: 'high', file: 'a.ts', line: n, msg: 'x', scenario: 'y' })
/** A claimed build Run on a fresh Ticket, for finish_run. */
const buildRun = async () => {
  const { t } = await seed()
  const started = await jobs.startRunIfNeeded(payload, t as any, 'build')
  const { leaseToken } = await call(member, 'claim_run', { runId: started.run.id })
  return { runId: started.run.id as number, leaseToken: leaseToken as string, ticket: t }
}

it('F1: finish_run refuses a prUrl that is not an open factory PR of the Ticket repo', async () => {
  const r = await buildRun()
  const n = r.ticket.number as number
  const mk = async (head: string) => {
    await fake.forge.createBranch(repo, head)
    fake.commit(repo, head, 'a.ts', head)
    return fake.forge.openPullRequest(repo, { title: 't', body: EVIDENCE, head, base: 'main' })
  }
  const foreign = await mk(`other-${n}`)
  const fork = await mk(`bauherr/${n}-fork`)
  fake.setPullRequest(repo, fork.number, { headRepo: 'evil/web' })
  const closed = await mk(`bauherr/${n}-closed`)
  fake.close(repo, closed.number)
  const wrongTicket = await mk(`bauherr/${n + 999}-x`)
  for (const url of [foreign.url, fork.url, closed.url, wrongTicket.url, `https://github.com/evil/web/pull/1`, 'nope']) {
    await expect(call(member, 'finish_run', { runId: r.runId, leaseToken: r.leaseToken, status: 'succeeded', prUrl: url })).rejects.toThrow('prUrl must be an open pull request')
  }
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).status).toBe('running')
  const ok = await mk(`bauherr/${n}-ok`)
  await expect(call(member, 'finish_run', { runId: r.runId, leaseToken: r.leaseToken, status: 'succeeded', prUrl: ok.url })).resolves.toMatchObject({ status: 'succeeded' })
})

it('F1: a fork or foreign-branch PR is never reviewed or merged (prOf and the gate both refuse)', async () => {
  const { id, pr, n } = await seed({ checks: green })
  fake.setPullRequest(repo, pr.number, { headRepo: 'evil/web' })
  expect(await release.prOf(payload, await reload(id))).toBeNull()
  const real = await seed({ checks: green })
  const mr = (await release.prOf(payload, await reload(real.id)))!
  fake.setPullRequest(repo, real.pr.number, { head: 'main' })
  expect(await actions.mergeGate(payload, await reload(real.id), { ...mr, pr: { ...mr.pr, head: 'main' } }, real.pr.headSha)).toBe('needs_human')
  expect(await prState(real.pr.number)).toBe('open')
  expect(n).toBeTruthy()
})

it('F2: the verdict is bound to the reviewed SHA; a moved head restarts the review without a round', async () => {
  const { id, pr, branch } = await seed({ checks: [{ name: 'ci', status: 'in_progress', conclusion: null }] })
  const r = await review(id)
  expect(await submit(r)).toMatchObject({ outcome: 'waiting_checks' })
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).reviewedSha).toBe(pr.headSha)
  fake.commit(repo, branch, 'a.ts', 'moved')
  const moved = await fake.forge.getPullRequest(repo, pr.number)
  fake.setChecks(repo, moved.headSha, green)
  expect(await actions.watchReviews(payload)).toBe(0)
  expect(await prState(pr.number)).toBe('open')
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: null, reviewRounds: 0 })
  const active = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'review' } }, { status: { in: jobs.ACTIVE } }] }, ...o })).docs
  expect(active).toHaveLength(1)
  const again = await call(member, 'claim_run', { runId: active[0]!.id })
  expect(await submit({ runId: active[0]!.id as number, leaseToken: again.leaseToken })).toMatchObject({ outcome: 'merged' })
})

it('F2: the merge itself is pinned to the reviewed SHA', async () => {
  const { id, pr, branch } = await seed({ checks: green })
  const mr = (await release.prOf(payload, await reload(id)))!
  const reviewed = mr.pr.headSha
  mr.pr = { ...mr.pr }
  fake.commit(repo, branch, 'a.ts', 'race')
  const spy = fake.forge.mergePullRequest
  const seen: any[] = []
  fake.forge.mergePullRequest = async (...a) => (seen.push(a[2]), spy(...a))
  try {
    await actions.mergeGate(payload, await reload(id), mr, reviewed)
  } finally {
    fake.forge.mergePullRequest = spy
  }
  expect(seen).toMatchObject([{ expectSha: reviewed }]) // the forge refuses: the head is no longer the reviewed SHA
  expect(await prState(pr.number)).toBe('open')
})

it('F4: a verdict that contradicts its findings goes to a human, not to a merge', async () => {
  const a = await seed({ checks: green })
  expect(await submit(await review(a.id), [medium], 'm', { verdict: 'clean' })).toMatchObject({ outcome: 'ready_for_human' })
  expect(await prState(a.pr.number)).toBe('open')
  const b = await seed({ checks: green })
  expect(await submit(await review(b.id), [], 'm', { verdict: 'changes' })).toMatchObject({ outcome: 'ready_for_human' })
  expect(await prState(b.pr.number)).toBe('open')
  expect((await reload(b.id)).reviewState).toBe('ready_for_human')
})

it('F3: a review without the full checked list goes to a human, not to a merge', async () => {
  const { id, pr, n } = await seed({ checks: green })
  expect(await submit(await review(id), [], 'm', { checked: checked.slice(0, 3) })).toMatchObject({ outcome: 'ready_for_human' })
  expect(await prState(pr.number)).toBe('open')
  expect((await reload(id)).reviewState).toBe('ready_for_human')
  expect((await comments(n)).some((c) => c.includes('did not account for: evidence'))).toBe(true)
})

it('F6/F7: review output is bounded and findings are one line', () => {
  const base = { verdict: 'changes', markdown: 'm', checked }
  const bad = (f: object) => expect(() => actions.normalizeReview({ ...base, findings: [{ ...medium, ...f }] })).toThrow('finding 0')
  for (const file of ['../a b', '../a', 'a/../b', '..', 'a/..', 'a b', 'a\nb', 'a\tb']) bad({ file })
  bad({ file: 'a'.repeat(301) })
  bad({ line: -1 })
  bad({ line: 1.5 })
  bad({ msg: 'x'.repeat(1001) })
  bad({ scenario: 'x'.repeat(1001) })
  expect(() => actions.normalizeReview({ ...base, findings: Array.from({ length: 51 }, () => medium) })).toThrow('at most 50')
  expect(() => actions.normalizeReview({ ...base, findings: [], markdown: 'x'.repeat(60_001) })).toThrow('60000')
  expect(actions.normalizeReview({ ...base, findings: [{ ...medium, file: 'src/@a+b/c-d_e.ts', line: 0 }] }).problem).toBeUndefined()
})

it('F6: finding paths accept route groups and dynamic segments; schema and normalizeReview agree', async () => {
  const { tools } = await import('../src/lib/mcp-tools')
  const schema = tools.find((t) => t.name === 'submit_review')!.inputSchema as any
  const pattern = new RegExp(schema.properties.findings.items.properties.file.pattern)
  expect(schema.properties.findings.items.properties.file.pattern).toBe(actions.FILE_PATTERN)
  const base = { verdict: 'changes', markdown: 'm', checked }
  const ok = ['apps/server/src/app/(app)/(shell)/tickets/[id]/page.tsx', 'a..b.ts']
  const no = ['../a', 'a/../b', '..', 'a b', 'a\nb', 'a\tb', 'a'.repeat(301)]
  for (const file of ok) {
    expect(pattern.test(file)).toBe(true)
    expect(() => actions.normalizeReview({ ...base, findings: [{ ...medium, file }] })).not.toThrow()
  }
  for (const file of no) {
    expect(pattern.test(file)).toBe(false)
    expect(() => actions.normalizeReview({ ...base, findings: [{ ...medium, file }] })).toThrow('finding 0')
  }
})

it('F7: a finding cannot inject worklog structure through newlines', async () => {
  const { id } = await seed({ checks: green })
  await submit(await review(id), [{ ...medium, msg: 'bad\n**Goal**\n- [x] hacked', scenario: 'a\n\n## b' }])
  const log = await actions.readWorklog(payload, member, { ticket: id })
  expect(log).toContain('[medium] a.ts:3 bad **Goal** - [x] hacked Scenario: a ## b')
})

it('F5: a failure while concluding parks the Ticket on a human and keeps the Run succeeded', async () => {
  const { id, n } = await seed({ checks: green })
  const r = await review(id)
  const spy = fake.forge.commentOnPullRequest
  fake.forge.commentOnPullRequest = async () => {
    throw new Error('forge down')
  }
  try {
    expect(await submit(r)).toMatchObject({ outcome: 'needs_human' })
  } finally {
    fake.forge.commentOnPullRequest = spy
  }
  expect((await reload(id)).reviewState).toBe('needs_human')
  expect((await comments(n)).some((c) => c.includes('concluding the review failed: forge down'))).toBe(true)
  expect((await payload.findByID({ collection: 'runs', id: r.runId, ...o })).status).toBe('succeeded')
})

it('F9: red and pending commit statuses (mapped to checks) block, and F10: zero checks need an old head', async () => {
  const mc = release.mergeChecks
  expect(mc([{ name: 'ci/s', status: 'completed', conclusion: 'failure' }])).toEqual({ state: 'red', failed: ['ci/s'] })
  expect(mc([{ name: 'ci/s', status: 'in_progress', conclusion: null }, { id: 1, name: 'b', status: 'completed', conclusion: 'success' }]).state).toBe('pending')
  expect(mc([], 60_000).state).toBe('pending')
  expect(mc([], release.CHECKS_GRACE_MS).state).toBe('green')
  const { id, pr } = await seed()
  fake.setCommitDate(repo, pr.headSha, new Date().toISOString())
  expect(await submit(await review(id))).toMatchObject({ outcome: 'waiting_checks' })
  expect(await prState(pr.number)).toBe('open')
  fake.setCommitDate(repo, pr.headSha, new Date(Date.now() - 11 * 60_000).toISOString())
  expect(await actions.watchReviews(payload)).toBeGreaterThanOrEqual(1)
  expect(await prState(pr.number)).toBe('merged')
})

it('F11/F14: returning to Build is a no-op unless the Ticket is in an open review state and the MR is open; it cancels active review Runs', async () => {
  const a = await seed({ checks: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] })
  await payload.update({ collection: 'tickets', id: a.id, data: { reviewState: 'needs_human' }, ...o })
  const mrA = (await release.prOf(payload, await reload(a.id)))!
  expect(await actions.mergeGate(payload, await reload(a.id), mrA, a.pr.headSha)).toBe('noop')
  expect(await reload(a.id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', reviewRounds: 0 })

  const b = await seed({ checks: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] })
  const mrB0 = (await release.prOf(payload, await reload(b.id)))!
  const mrB = { ...mrB0, pr: { ...mrB0.pr } }
  fake.close(repo, b.pr.number)
  expect(await actions.mergeGate(payload, await reload(b.id), mrB, b.pr.headSha)).toBe('noop')
  expect(await reload(b.id)).toMatchObject({ stage: 'review', reviewRounds: 0 })

  const c = await seed({ checks: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] })
  const active = await jobs.startRunIfNeeded(payload, (await reload(c.id)) as any, 'review')
  const mrC = (await release.prOf(payload, await reload(c.id)))!
  expect(await actions.mergeGate(payload, await reload(c.id), mrC, c.pr.headSha)).toBe('build')
  expect((await payload.findByID({ collection: 'runs', id: active.run.id, ...o })).status).toBe('cancelled')
})

it('F12: waiting on checks for more than 2 hours, or 3 failed merges in a row, needs a human', async () => {
  const a = await seed({ checks: [{ name: 'ci', status: 'in_progress', conclusion: null }] })
  expect(await submit(await review(a.id))).toMatchObject({ outcome: 'waiting_checks' })
  expect((await reload(a.id)).reviewWaitingSince).toBeTruthy()
  await actions.watchReviews(payload, Date.now() + 1.9 * 3_600_000)
  expect((await reload(a.id)).reviewState).toBe('waiting_checks')
  await actions.watchReviews(payload, Date.now() + 2.1 * 3_600_000)
  expect((await reload(a.id)).reviewState).toBe('needs_human')
  expect((await comments(a.n)).some((c) => c.includes('waiting on checks'))).toBe(true)

  const b = await seed({ checks: [{ name: 'ci', status: 'in_progress', conclusion: null }] })
  await submit(await review(b.id))
  fake.setChecks(repo, b.pr.headSha, green)
  const spy = fake.forge.mergePullRequest
  fake.forge.mergePullRequest = async () => {
    throw new Error('not mergeable')
  }
  try {
    for (const state of ['waiting_checks', 'waiting_checks', 'needs_human']) {
      await actions.watchReviews(payload)
      expect((await reload(b.id)).reviewState).toBe(state)
    }
  } finally {
    fake.forge.mergePullRequest = spy
  }
  expect((await comments(b.n)).some((c) => c.includes('failed 3 times in a row: not mergeable'))).toBe(true)
})

it('F20: a draft MR is not merged and stays waiting', async () => {
  const { id, pr } = await seed({ checks: green })
  fake.setPullRequest(repo, pr.number, { draft: true })
  expect(await submit(await review(id))).toMatchObject({ outcome: 'waiting_checks' })
  expect(await prState(pr.number)).toBe('open')
  fake.setPullRequest(repo, pr.number, { draft: false })
  expect(await actions.watchReviews(payload)).toBeGreaterThanOrEqual(1)
  expect(await prState(pr.number)).toBe('merged')
})

it('F15: ## Evidence needs the exact heading and content after it', () => {
  expect(actions.hasEvidence('x\n## Evidence\n| a |')).toBe(true)
  expect(actions.hasEvidence('## Evidence of run\nfoo')).toBe(true)
  expect(actions.hasEvidence('## Evidence\n\n')).toBe(false)
  expect(actions.hasEvidence('## Evidence\n\n## Next\nfoo')).toBe(false)
  expect(actions.hasEvidence('### Evidence\nfoo')).toBe(false)
  expect(actions.hasEvidence('see ## Evidence\nfoo')).toBe(false)
  expect(actions.hasEvidence('## Evidences\nfoo')).toBe(false)
})

it('a pending (asynchronous) merge waits without counting a failure', async () => {
  const a = await seed({ checks: green })
  const r = await review(a.id)
  const spy = fake.forge.mergePullRequest
  fake.forge.mergePullRequest = async () => {
    throw new MergePendingError('not merged yet')
  }
  try {
    expect(await submit(r)).toMatchObject({ outcome: 'waiting_checks' })
    for (let i = 0; i < 4; i++) {
      await actions.watchReviews(payload)
      expect((await reload(a.id)).reviewState).toBe('waiting_checks')
    }
  } finally {
    fake.forge.mergePullRequest = spy
  }
  expect(Number((await reload(a.id)).mergeFailures ?? 0)).toBe(0)
  await actions.watchReviews(payload)
  expect(await prState(a.pr.number)).toBe('merged')
})

it('a perpetually pending merge keeps its wait clock and escalates after 2 hours', async () => {
  const a = await seed({ checks: green })
  const r = await review(a.id)
  const spy = fake.forge.mergePullRequest
  fake.forge.mergePullRequest = async () => {
    throw new MergePendingError('not merged yet')
  }
  try {
    expect(await submit(r)).toMatchObject({ outcome: 'waiting_checks' })
    const since = (await reload(a.id)).reviewWaitingSince
    expect(since).toBeTruthy()
    await actions.watchReviews(payload, Date.now() + 1.9 * 3_600_000)
    expect((await reload(a.id)).reviewWaitingSince).toEqual(since)
    await actions.watchReviews(payload, Date.now() + 2.1 * 3_600_000)
    expect((await reload(a.id)).reviewState).toBe('needs_human')
  } finally {
    fake.forge.mergePullRequest = spy
  }
})

/** The crash window: the review Run holds its verdict, the Ticket never moved. */
const crashed = async (id: number, pr: { headSha: string }, findings: any[] = [], problem?: string) => {
  const r = await review(id)
  const verdict = findings.some((f) => f.severity !== 'low') ? 'changes' : 'clean'
  await payload.update({ collection: 'runs', id: r.runId, data: { status: 'succeeded', verdict, findings, reviewedSha: pr.headSha, finishedAt: new Date(Date.now() - 5 * 60_000).toISOString(), artifacts: { review: { markdown: 'm', ...(problem && { problem }) } } }, ...o })
  return r
}
const countComments = () => {
  const spy = fake.forge.commentOnPullRequest
  const calls: string[] = []
  fake.forge.commentOnPullRequest = async (...a: Parameters<typeof spy>) => (calls.push(a[2]), spy(...a))
  return { calls, restore: () => void (fake.forge.commentOnPullRequest = spy) }
}

it('resume: a recorded changes verdict ends in a Build Run without a second MR comment', async () => {
  const { id, pr } = await seed({ checks: green })
  await crashed(id, pr, [medium])
  await fake.forge.commentOnPullRequest(repo, pr.number, `${actions.REVIEW_MARKER}\nm`)
  const c = countComments()
  try {
    expect(await actions.resumeReviews(payload)).toBe(1)
  } finally {
    c.restore()
  }
  expect(c.calls).toHaveLength(0)
  expect((await reload(id)).stage).toBe('build')
  expect(await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, ...o })).toMatchObject({ totalDocs: 1 })
})

it('resume: the MR comment is posted when the crash happened before it, once', async () => {
  const { id, pr } = await seed({ checks: green })
  await crashed(id, pr)
  const c = countComments()
  try {
    await actions.resumeReviews(payload)
  } finally {
    c.restore()
  }
  expect(c.calls).toEqual([`${actions.REVIEW_MARKER}\nm`])
})

it('resume: a Run of an earlier round is not applied; a fresh review starts', async () => {
  const { id, pr, n } = await seed({ checks: green })
  await crashed(id, pr, [medium])
  await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, finishedAt: new Date(Date.now() - 60_000).toISOString() }, ...o })
  const c = countComments()
  try {
    expect(await actions.resumeReviews(payload)).toBe(0)
  } finally {
    c.restore()
  }
  expect(c.calls).toHaveLength(0)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewRounds: 0 })
  expect(await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'review' } }, { status: { equals: 'awaiting_session' } }] }, ...o })).toMatchObject({ totalDocs: 1 })
  expect(await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { in: ['awaiting_session', 'running'] } }] }, ...o })).toMatchObject({ totalDocs: 0 })
  expect(n).toBeTruthy()
})

it('resume: a Run that reviewed an older head is not applied', async () => {
  const { id, pr } = await seed({ checks: green })
  await crashed(id, pr, [medium])
  fake.commit(repo, pr.head, 'b.ts', 'y')
  expect(await actions.resumeReviews(payload)).toBe(0)
  expect((await reload(id)).reviewRounds).toBe(0)
})

it('resume: a recorded clean verdict merges', async () => {
  const { id, pr } = await seed({ checks: green })
  await crashed(id, pr)
  expect(await actions.resumeReviews(payload)).toBe(1)
  expect(await prState(pr.number)).toBe('merged')
})

it('resume: a stored problem goes to a human, never to merge or Build', async () => {
  const { id, pr } = await seed({ checks: green })
  await crashed(id, pr, [], 'the review did not account for: evidence')
  await actions.resumeReviews(payload)
  expect((await reload(id)).reviewState).toBe('ready_for_human')
  expect(await prState(pr.number)).toBe('open')
})

it('resume: nothing is retried inside the grace, while a review Run is active, or in a parked state', async () => {
  const fresh = await seed({ checks: green })
  const r = await crashed(fresh.id, fresh.pr)
  await payload.update({ collection: 'runs', id: r.runId, data: { finishedAt: new Date().toISOString() }, ...o })
  const active = await seed({ checks: green })
  await review(active.id)
  const parked = await Promise.all(['waiting_checks', 'needs_human', 'ready_for_human', 'merged'].map(async (reviewState) => {
    const s = await seed({ checks: green })
    await crashed(s.id, s.pr)
    await payload.update({ collection: 'tickets', id: s.id, data: { reviewState }, ...o })
    return s
  }))
  await actions.resumeReviews(payload)
  for (const s of [fresh, active]) {
    expect((await reload(s.id)).stage).toBe('review')
    expect((await reload(s.id)).reviewState ?? null).toBeNull()
    expect(await prState(s.pr.number)).toBe('open')
  }
  for (const s of parked) expect(await prState(s.pr.number)).toBe('open')
})

const touches = async (id: number, kind: string) => (await payload.find({ collection: 'human_touches', where: { and: [{ ticket: { equals: id } }, { kind: { equals: kind } }] }, ...o })).docs
const hitCap = async (id: number) => {
  for (const round of [1, 2]) {
    await submit(await review(id), [medium])
    await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  }
}

/** A review Ticket parked at the round cap (factory's grant already used), the escalation Comment posted. */
const atCap = async () => {
  const s = await seed({ checks: green })
  await hitCap(s.id)
  expect(await submit(await review(s.id), [medium])).toMatchObject({ outcome: 'build' })
  await payload.update({ collection: 'tickets', id: s.id, data: { stage: 'review' }, ...o })
  expect(await submit(await review(s.id), [medium])).toMatchObject({ outcome: 'needs_human' })
  return s
}

it('first cap hit is granted by the factory: Build on the same MR, factory touch, one Comment, no needs_human', async () => {
  const { id, n, pr } = await seed({ checks: green })
  await hitCap(id)
  expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'build' })
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, reviewRounds: 2 })
  const t = await touches(id, 'review-cap:auto-grant')
  expect(t).toHaveLength(1)
  expect(t[0]).toMatchObject({ actor: 'factory' })
  expect((await comments(n)).filter((b) => b.includes('the factory granted one more round'))).toHaveLength(1)
  const build = await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, ...o })
  expect(build.totalDocs).toBe(1)
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  expect(await submit(await review(id))).toMatchObject({ outcome: 'merged' })
  expect(await prState(pr.number)).toBe('merged')
})

it('second cap hit after the factory grant shows the owner Gate', async () => {
  const { id } = await atCap()
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', reviewRounds: 3 })
  expect(await touches(id, 'review-cap:auto-grant')).toHaveLength(1)
})

it('an earlier owner grant uses up the factory grant', async () => {
  const { id } = await atCap()
  await actions.grantReviewRound(payload, member, { ticket: id })
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'needs_human' })
  expect(await touches(id, 'review-cap:auto-grant')).toHaveLength(1)
})

it('grant at the round cap: exactly one more round on the same MR, then a clean review merges', async () => {
  const { id, pr } = await atCap()
  expect(await actions.grantReviewRound(payload, member, { ticket: id })).toMatchObject({ stage: 'build' })
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, reviewRounds: 2 })
  const build = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, ...o })).docs
  expect(build).toHaveLength(1)
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('[medium] a.ts:3 off by one')
  expect(await touches(id, 'review-cap:grant')).toHaveLength(1)
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  expect(await submit(await review(id))).toMatchObject({ outcome: 'merged' })
  expect(await prState(pr.number)).toBe('merged')
})

it('after a grant a second cap hit shows the gate again', async () => {
  const { id } = await atCap()
  await actions.grantReviewRound(payload, member, { ticket: id })
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  expect(await submit(await review(id), [medium])).toMatchObject({ outcome: 'needs_human' })
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', reviewRounds: 3 })
})

it('grant and stop refuse a Ticket that is not at the cap, and a double grant', async () => {
  const a = await seed({ checks: green })
  await payload.update({ collection: 'tickets', id: a.id, data: { reviewState: 'needs_human' }, ...o })
  await expect(actions.grantReviewRound(payload, member, { ticket: a.id })).rejects.toThrow('not at the review round cap')
  await expect(actions.stopReview(payload, member, { ticket: a.id })).rejects.toThrow('not at the review round cap')
  expect(await reload(a.id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', reviewRounds: 0 })
  const { id } = await atCap()
  await actions.grantReviewRound(payload, member, { ticket: id })
  await expect(actions.grantReviewRound(payload, member, { ticket: id })).rejects.toThrow('not at the review round cap')
  expect(await reload(id)).toMatchObject({ reviewRounds: 2 })
})

it('stop at the cap moves to triage with a note, the MR stays open', async () => {
  const { id, n, pr } = await atCap()
  await actions.stopReview(payload, member, { ticket: id, note: 'needs a redesign' })
  expect(await reload(id)).toMatchObject({ stage: 'triage', reviewState: null, reviewRounds: 3 })
  expect(await prState(pr.number)).toBe('open')
  expect((await comments(n)).some((b) => b.startsWith('Stopped at the review round cap') && b.includes('needs a redesign'))).toBe(true)
  expect(await touches(id, 'review-cap:stop')).toHaveLength(1)
})

it('grant_review_round and stop_review over MCP: an agent key is refused, a human works', async () => {
  const { id } = await atCap()
  const { callTool } = await import('../src/lib/mcp-tools')
  const { mintAgentKey, resolveAgentKey } = await import('../src/lib/api-key')
  const agent = { kind: 'agent', keyId: (await resolveAgentKey(payload, await mintAgentKey(payload, member as { id: number }, 'r')))!.keyId } as const
  for (const name of ['grant_review_round', 'stop_review']) {
    await expect(callTool({ payload, user: member, actor: agent }, name, { ticket: id })).rejects.toThrow('needs a human')
  }
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', reviewRounds: 3 })
  expect(await call(member, 'grant_review_round', { ticket: id })).toMatchObject({ stage: 'build' })
  const capped = await atCap()
  expect(await call(member, 'stop_review', { ticket: capped.id, note: 'redesign' })).toBeTruthy()
  expect(await reload(capped.id)).toMatchObject({ stage: 'triage' })
})

const conflictCheck = async (id: number) => {
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, mergeFailures: 0 })
  expect(await actions.readWorklog(payload, member, { ticket: id })).toContain('Merge `main` into')
  const build = await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, ...o })
  expect(build.totalDocs).toBe(1)
}

it('F21: a clean review of a conflicting MR returns to Build without a round or a merge failure', async () => {
  const { id, pr } = await seed({ checks: green })
  fake.setMergeable(repo, pr.number, false)
  expect(await submit(await review(id))).toMatchObject({ verdict: 'clean', outcome: 'build' })
  expect(await prState(pr.number)).toBe('open')
  await conflictCheck(id)
})

it('F22: a waiting_checks Ticket whose MR turned unmergeable returns to Build on the next watch pass', async () => {
  const { id, pr } = await seed({ checks: [{ name: 'ci', status: 'in_progress', conclusion: null }] })
  expect(await submit(await review(id))).toMatchObject({ outcome: 'waiting_checks' })
  fake.setMergeable(repo, pr.number, false)
  await actions.watchReviews(payload)
  await conflictCheck(id)
})

it('F23: a merge that fails while the MR reads as conflicting takes the conflict route', async () => {
  const { id, pr } = await seed({ checks: green })
  const spy = fake.forge.mergePullRequest
  fake.forge.mergePullRequest = async () => {
    fake.setMergeable(repo, pr.number, false)
    throw new Error('merge commit cannot be cleanly created')
  }
  try {
    expect(await submit(await review(id))).toMatchObject({ outcome: 'build' })
  } finally {
    fake.forge.mergePullRequest = spy
  }
  await conflictCheck(id)
})

it('F24: two conflicting PRs: the first merges, the second merges main, is re-reviewed on the new head and merges', async () => {
  const a = await seed({ checks: green })
  const b = await seed({ checks: green })
  expect(await submit(await review(a.id))).toMatchObject({ outcome: 'merged' })
  fake.setMergeable(repo, b.pr.number, false)
  expect(await submit(await review(b.id))).toMatchObject({ outcome: 'build' })
  await conflictCheck(b.id)
  const before = (await fake.forge.getPullRequest(repo, b.pr.number)).headSha
  fake.commit(repo, b.branch, 'a.ts', 'merged')
  const head = (await fake.forge.getPullRequest(repo, b.pr.number)).headSha
  expect(head).not.toBe(before)
  expect(await reload(b.id)).toMatchObject({ conflictReturnBase: before, conflictReturns: 1 })
  await payload.update({ collection: 'tickets', id: b.id, data: { stage: 'review' }, ...o })
  const r = await review(b.id)
  expect((await call(member, 'get_ticket', { ticket: b.id })).conflictReturnBase).toBe(before)
  expect(await submit(r)).toMatchObject({ outcome: 'merged' })
  expect(await reload(b.id)).toMatchObject({ conflictReturnBase: null })
  expect(await payload.findByID({ collection: 'runs', id: r.runId, ...o })).toMatchObject({ reviewedSha: head })
  expect(await prState(b.pr.number)).toBe('merged')
})

it('F25: a conflict return at the round cap still goes to Build', async () => {
  const { id, pr } = await seed({ checks: green })
  await payload.update({ collection: 'tickets', id, data: { reviewRounds: 2 }, ...o })
  fake.setMergeable(repo, pr.number, false)
  expect(await submit(await review(id))).toMatchObject({ outcome: 'build' })
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewRounds: 2 })
})

it('F26: the next review Run is told the previous reviewed SHA, server-side, regardless of the worklog', async () => {
  const { id, pr, n, branch } = await seed({ checks: green })
  const base = pr.headSha
  fake.setMergeable(repo, pr.number, false)
  await submit(await review(id))
  expect((await reload(id)).conflictReturnBase).toBe(base)
  const log = (await fake.tickets(repo).listComments(n)).find((c) => c.body.startsWith('<!-- bauherr:worklog -->'))!
  await fake.tickets(repo).updateComment(n, log.id, '<!-- bauherr:worklog -->\n## Worklog\n**Current instructions**\nready for review')
  fake.commit(repo, branch, 'a.ts', 'merged')
  fake.setMergeable(repo, pr.number, undefined as any)
  await payload.update({ collection: 'tickets', id, data: { stage: 'review' }, ...o })
  const started = await jobs.startReviewIfReady(payload, (await reload(id)) as any)
  const claim = await call(member, 'claim_run', { runId: started!.run.id })
  expect(claim.ticket.conflictReturnBase).toBe(base)
})

it('F27: a 4th conflict return needs a human instead of looping', async () => {
  const { id, pr } = await seed({ checks: green })
  await payload.update({ collection: 'tickets', id, data: { conflictReturns: 3 }, ...o })
  fake.setMergeable(repo, pr.number, false)
  expect(await submit(await review(id))).toMatchObject({ outcome: 'needs_human' })
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', conflictReturns: 3 })
})

it('F28: recovery: Tickets parked on 3 failed merges return to Build when the MR conflicts; others stay with the human and are checked once', async () => {
  const parked = async (conflicting: boolean) => {
    const s = await seed({ checks: [{ name: 'ci', status: 'in_progress', conclusion: null }] })
    await submit(await review(s.id))
    await payload.update({ collection: 'tickets', id: s.id, data: { reviewState: 'needs_human', mergeFailures: 3, conflictReturns: null }, ...o })
    fake.setChecks(repo, s.pr.headSha, green)
    if (conflicting) fake.setMergeable(repo, s.pr.number, false)
    return s
  }
  const ok = await parked(false)
  const bad = await parked(true)
  await actions.watchReviews(payload)
  expect(await prState(ok.pr.number)).toBe('open')
  expect(await reload(bad.id)).toMatchObject({ stage: 'build', mergeFailures: 0, conflictReturns: 1 })
  expect(await reload(ok.id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', conflictReturns: 0 })
})
