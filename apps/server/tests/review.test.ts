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
  bad({ file: '../a b' })
  bad({ file: 'a'.repeat(301) })
  bad({ line: -1 })
  bad({ line: 1.5 })
  bad({ msg: 'x'.repeat(1001) })
  bad({ scenario: 'x'.repeat(1001) })
  expect(() => actions.normalizeReview({ ...base, findings: Array.from({ length: 51 }, () => medium) })).toThrow('at most 50')
  expect(() => actions.normalizeReview({ ...base, findings: [], markdown: 'x'.repeat(60_001) })).toThrow('60000')
  expect(actions.normalizeReview({ ...base, findings: [{ ...medium, file: 'src/@a+b/c-d_e.ts', line: 0 }] }).problem).toBeUndefined()
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
