import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { scanned } from './helpers/plan-scan'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let fake: FakeBackend
let product: number
let ws: number
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
let liveness: typeof import('../src/lib/liveness')
let mergeMain: typeof import('../src/lib/merge-main')
let owner: Doc
let productOwner: Doc
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const EVIDENCE = 'Refs it\n\n## Evidence\n| Goal | verified |\n\n## Blast radius\nSafe because x. Sure: `read the code`\n'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const PLAN = (items: string[]) => `<!-- bauherr:plan -->\n## Goal\n- g\n\n## Sub-tickets\n${items.map((t, i) => `- **${t}** — body ${i}.${i ? `\n  after: ${items[0]}` : ''}`).join('\n')}\n`

let testDb: TestDb
let root: string
let bare: string
const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'd@x', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'd@x' } }).toString().trim()
const work = () => join(root, 'work')
const realHead = (branch: string) => git(bare, 'rev-parse', `refs/heads/${branch}`)
let edits = 0
/** Puts `branch` into the bare repo with one commit, then moves main with one commit of its own. */
const gitEpicBranch = (branch: string, mr: [string, string], main: [string, string]) => {
  const edit = ([file, text]: [string, string], msg: string) => {
    execFileSync('sh', ['-c', `printf '%s\\n' "$1" > "$2"`, 'sh', `${text}${++edits}`, join(work(), file)])
    git(work(), 'add', '-A')
    git(work(), 'commit', '-m', msg)
  }
  git(work(), 'checkout', '-B', branch, 'main')
  edit(mr, 'mr')
  git(work(), 'push', '-f', 'origin', branch)
  git(work(), 'checkout', 'main')
  edit(main, 'main')
  git(work(), 'push', 'origin', 'main')
}

beforeAll(async () => {
  testDb = await createTestDb('epic_flow')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  release = await import('../src/lib/release')
  liveness = await import('../src/lib/liveness')
  mergeMain = await import('../src/lib/merge-main')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  root = mkdtempSync(join(tmpdir(), 'bauherr-epic-'))
  bare = join(root, 'acme/web.git')
  process.env.BAUHERR_GIT_BASE_URL = `file://${root}`
  git(root, 'init', '--bare', '-b', 'main', bare)
  git(root, 'clone', bare, work())
  git(work(), 'checkout', '-B', 'main')
  git(work(), 'commit', '--allow-empty', '-m', 'init')
  git(work(), 'push', 'origin', 'main')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  owner = await payload.create({ collection: 'bauherren', data: { email: 'o@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  productOwner = await payload.create({ collection: 'bauherren', data: { email: 'po@x.io', password: 'pw-123456', role: 'product-owner', assignments: [{ workspace: ws, scope: 'workspace' }] } as never, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number | string) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Doc
const kids = async (parent: number) => (await payload.find({ collection: 'tickets', where: { parent: { equals: parent } }, sort: 'number', depth: 0, ...o })).docs as Doc[]
const mergeJobs = async () => (await payload.count({ collection: 'payload-jobs' as never, where: { taskSlug: { equals: 'merge-main' } } as never, ...o })).totalDocs
const forgeIssue = async (n: number) => fake.tickets(repo).get(String(n))

/** A plan Ticket with a posted `## Sub-tickets` plan, split into an epic by `spawnSubTickets`. */
const split = async (items = ['One', 'Two', 'Three']) => {
  const issue = await fake.tickets(repo).create({ title: 'epic', labels: ['bauherr:stage:plan'] })
  await fake.tickets(repo).comment(String(issue.number), PLAN(items))
  const row = await payload.create({ collection: 'tickets', data: { title: 'epic', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', labels: issue.labels, stage: 'plan', product, workspace: ws, rank: 'm' }, ...o })
  expect(await actions.spawnSubTickets(payload, row)).toBe(true)
  return reload(row.id)
}
/** Opens the epic PR on the epic branch (what slice 1's Run does) and records it on the parent. */
const openEpicPr = async (parent: Doc) => {
  const branch = parent.epic.branch as string
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, `${branch}.ts`, 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: parent.title, body: EVIDENCE, head: branch, base: 'main' })
  fake.setChecks(repo, pr.headSha, green)
  await actions.setEpicPr(payload, (await kids(parent.id))[0]!, pr.url)
  return pr
}
/** The current slice of `parent`, in review with the epic PR; `mergeGate` on its head. */
const gate = async (sub: Doc) => {
  await payload.update({ collection: 'tickets', id: sub.id, data: { stage: 'review', reviewState: null }, ...o })
  const t = await reload(sub.id)
  const mr = (await release.prOf(payload, t))!
  return { t, mr, run: () => actions.mergeGate(payload, t, mr, mr.pr.headSha) }
}

it('a plan with Sub-tickets becomes an epic: the epic branch and slice list in plan order, `after:` ignored, only slice 0 exists', async () => {
  const parent = await split()
  expect(parent.stage).toBe('parent')
  expect(parent.epic).toMatchObject({ branch: `bauherr/${parent.number}-epic`, current: 0, mergeFailures: 0 })
  expect(parent.epic.slices.map((s: Doc) => [s.title, s.ticket ? 'ticket' : null])).toEqual([['One', 'ticket'], ['Two', null], ['Three', null]])
  const subs = await kids(parent.id)
  expect(subs).toHaveLength(1)
  expect(subs[0]).toMatchObject({ title: 'One', inheritedApprovalFrom: parent.id, blockedBy: [], slice: { epic: parent.id, branch: parent.epic.branch, index: 0, prev: null, main: null, head: null, passed: false, fixes: [] } })
  expect(parent.epic.slices[0].ticket).toBe(subs[0]!.id)
  expect(await fake.tickets(repo).listSubTickets(String(parent.number))).toHaveLength(1)
})

it('a clean slice review on green checks passes the slice without merging the PR; the next slice starts after it with prev = its head', async () => {
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  const g = await gate(first!)
  expect(await g.run()).toBe('slice_passed')
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('open')
  expect(await reload(first!.id)).toMatchObject({ stage: 'done', state: 'open', slice: { head: pr.headSha, passed: true } })
  expect((await forgeIssue(first!.number)).state).toBe('open')
  const subs = await kids(parent.id)
  expect(subs.map((s) => s.title)).toEqual(['One', 'Two'])
  expect(subs[1]).toMatchObject({ slice: { index: 1, prev: pr.headSha, passed: false }, stage: 'plan' })
  expect((await reload(parent.id)).epic).toMatchObject({ current: 1, pr: pr.url })
  expect(parent.epic.slices[1].ticket).toBeUndefined()
  expect((await reload(parent.id)).epic.slices[1].ticket).toBe(subs[1]!.id)
})

it('advanceEpic is idempotent: a second call (double poll) creates nothing', async () => {
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  await (await gate(first!)).run()
  expect(await actions.advanceEpic(payload, await reload(parent.id))).toBe(false)
  expect(await actions.advanceEpic(payload, parent)).toBe(false)
  expect(await actions.advanceEpics(payload)).toBe(0)
  expect(await kids(parent.id)).toHaveLength(2)
  expect((await reload(parent.id)).epic.current).toBe(1)
  expect(pr.number).toBeGreaterThan(0)
})

it('the poll sweep creates the next slice when the gate passed but the call after it was lost', async () => {
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'done', slice: { ...first!.slice, head: pr.headSha, passed: true } }, ...o })
  expect(await actions.advanceEpics(payload)).toBe(1)
  expect(await actions.advanceEpics(payload)).toBe(0)
  expect(await kids(parent.id)).toHaveLength(2)
})

it('red checks send the slice back to Build, pending ones wait, a moved head restarts the review; no next slice in any case', async () => {
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  const g = await gate(first!)
  fake.setChecks(repo, pr.headSha, [{ name: 'ci', status: 'in_progress', conclusion: null }])
  expect(await g.run()).toBe('waiting_checks')
  expect(await reload(first!.id)).toMatchObject({ stage: 'review', reviewState: 'waiting_checks' })
  expect(await actions.mergeGate(payload, await reload(first!.id), g.mr, 'older-sha')).toBe('review_restarted')
  await payload.update({ collection: 'tickets', id: first!.id, data: { reviewState: 'waiting_checks' }, ...o })
  fake.setChecks(repo, pr.headSha, [{ name: 'ci', status: 'completed', conclusion: 'failure' }])
  expect(await actions.mergeGate(payload, await reload(first!.id), g.mr, pr.headSha)).toBe('build')
  expect(await reload(first!.id)).toMatchObject({ stage: 'build', slice: { passed: false, head: null } })
  expect(await kids(parent.id)).toHaveLength(1)
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('open')
})

it('a blocking slice review sends the slice back to Build and the epic waits', async () => {
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  await gate(first!)
  const finding = { severity: 'high', class: 'correctness', file: 'a.ts', line: 1, msg: 'broken', scenario: 'when a, then b', slice: first!.number }
  const { outcome } = await actions.concludeReview(payload, first!.id, { verdict: 'changes', findings: [finding], markdown: 'm', open: [] } as never, pr.headSha)
  expect(outcome).toBe('build')
  expect(await reload(first!.id)).toMatchObject({ stage: 'build', slice: { passed: false } })
  expect(await kids(parent.id)).toHaveLength(1)
  expect((await reload(parent.id)).epic.current).toBe(0)
})

it('after the last slice the parent goes to epic review with the base merged first (merge-main queued once); the epic PR then merges once, from the parent', async () => {
  const parent = await split(['One', 'Two'])
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  await (await gate(first!)).run()
  const second = (await kids(parent.id))[1]!
  const before = await mergeJobs()
  expect(await (await gate(second)).run()).toBe('slice_passed')
  expect(await reload(parent.id)).toMatchObject({ stage: 'review', reviewState: 'waiting_checks' })
  expect(await mergeJobs()).toBe(before + 1)
  expect((await forgeIssue(parent.number)).labels).toContain('bauherr:stage:review')
  expect(await actions.advanceEpic(payload, await reload(parent.id))).toBe(false)
  expect(await actions.advanceEpics(payload)).toBe(0)
  expect(await mergeJobs()).toBe(before + 1)
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('open')
  // The epic review (a Review Run on the parent) ends in the normal merge gate on the epic PR.
  const t = await reload(parent.id)
  expect(await actions.mergeGate(payload, t, (await release.prOf(payload, t))!, pr.headSha)).toBe('merged')
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('merged')
})

it('merge-main accepts the epic parent: a clean merge keeps it in review, a real conflict sends the parent back to Build', async () => {
  for (const [conflict, file] of [[false, 'mine.ts'], [true, 'c.ts']] as const) {
    const parent = await split(['Only'])
    const branch = parent.epic.branch as string
    gitEpicBranch(branch, [file, 'mine'], [conflict ? file : 'main.ts', 'theirs'])
    await fake.forge.createBranch(repo, branch)
    const pr = await fake.forge.openPullRequest(repo, { title: 'epic', body: EVIDENCE, head: branch, base: 'main' })
    await actions.setEpicPr(payload, (await kids(parent.id))[0]!, pr.url)
    await payload.update({ collection: 'tickets', id: parent.id, data: { stage: 'review', reviewState: 'waiting_checks' }, ...o })
    const before = realHead(branch)
    await mergeMain.mergeMainIntoMr(payload, parent.id, null)
    if (conflict) expect(await reload(parent.id)).toMatchObject({ stage: 'build', conflictReturns: 1 })
    else {
      expect(realHead(branch)).not.toBe(before)
      expect(git(bare, 'log', '-1', '--format=%an', `refs/heads/${branch}`)).toBe('Bauherr')
      expect((await reload(parent.id)).reviewState).not.toBe('needs_human')
    }
  }
})

it('an accepted epic closes its open slices as completed, once', async () => {
  const parent = await split(['One', 'Two'])
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  await (await gate(first!)).run()
  await payload.update({ collection: 'tickets', id: parent.id, data: { stage: 'done', state: 'closed' }, ...o })
  expect(await actions.advanceEpics(payload)).toBe(0)
  for (const s of await kids(parent.id)) {
    expect(s.state).toBe('closed')
    expect((await forgeIssue(s.number)).state).toBe('closed')
  }
  expect(await actions.advanceEpics(payload)).toBe(0)
  expect(pr.number).toBeGreaterThan(0)
})

it('closeFinishedParents never finishes an epic parent', async () => {
  const parent = await split(['One'])
  const [first] = await kids(parent.id)
  await fake.tickets(repo).close(String(first!.number), 'completed')
  await actions.closeFinishedParents(payload)
  expect(await reload(parent.id)).toMatchObject({ stage: 'parent', state: 'open' })
})

it('the liveness watchdog never reports the parent while slicing or between slices, nor a passed slice', async () => {
  const parent = await split(['One', 'Two'])
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  const dead = async () => (await liveness.deadTickets(payload, ws)).map((d) => d.ticket.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'done', slice: { ...first!.slice, head: pr.headSha, passed: true } }, ...o })
  expect(await dead()).not.toContain(parent.id)
  expect(await dead()).not.toContain(first!.id)
  await actions.advanceEpic(payload, parent)
  expect(await dead()).not.toContain(parent.id)
})

it('setEpicPr records the first PR only', async () => {
  const parent = await split(['One'])
  const [first] = await kids(parent.id)
  await actions.setEpicPr(payload, first!, 'https://x/pull/1')
  await actions.setEpicPr(payload, first!, 'https://x/pull/2')
  expect((await reload(parent.id)).epic.pr).toBe('https://x/pull/1')
})

/** The earlier tests leave Tickets in the columns: lift the limits so the moves under test are not held. */
const unlimited = () => payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: { plan: 99, build: 99, review: 99 } }, ...o })
const worklogOf = async (n: number) => (await fake.tickets(repo).listComments(String(n))).findLast((c) => c.body.startsWith('<!-- bauherr:worklog'))?.body ?? ''
const commentsOf = async (n: number) => (await fake.tickets(repo).listComments(String(n))).map((c) => c.body)
/** Builds slice 1 (passed) and puts slice 2 into Build; returns both. */
const secondInBuild = async (items = ['One', 'Two', 'Three']) => {
  await unlimited()
  const parent = await split(items)
  const pr = await openEpicPr(parent)
  await (await gate((await kids(parent.id))[0]!)).run()
  const [first, second] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: second!.id, data: { stage: 'build' }, ...o })
  return { parent: await reload(parent.id), pr, first: first!, second: (await reload(second!.id)) }
}
/** The planner posts `plan` on the parent after a re-plan and its plan Run succeeded. */
const replanned = async (parent: Doc, plan: string) => {
  await fake.tickets(repo).comment(String(parent.number), plan)
  await payload.create({ collection: 'runs', data: { ticket: parent.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  await scanned(payload, parent.id, ws)
}
const sliceTitles = async (id: number) => (await reload(id)).epic.slices.map((s: Doc) => s.title)

it('replan on an unbuilt slice sends the parent back to plan, closes the slice as not planned and logs it in the epic worklog', async () => {
  const { advance } = await import('../src/lib/advance')
  await unlimited()
  const parent = await split()
  const [first] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'build' }, ...o })
  await advance(payload, null, await reload(first!.id), 'replan', { by: 'factory', note: 'Slice two needs a new API' })
  expect(await reload(parent.id)).toMatchObject({ stage: 'plan', state: 'open' })
  expect(await reload(first!.id)).toMatchObject({ state: 'closed', stage: 'build' })
  expect((await forgeIssue(first!.number)).state).toBe('closed')
  expect((await forgeIssue(parent.number)).labels).toContain('bauherr:stage:plan')
  expect(await worklogOf(parent.number)).toContain('Re-plan requested at slice 1')
  expect((await commentsOf(parent.number)).join('\n')).toContain('Built slices, to be kept unchanged and in order: none')
  expect(await actions.advanceEpics(payload)).toBe(0)
})

it('a re-plan that keeps the built slices and the Goal is accepted without the plan gate: slices rewritten, building continues at the first unbuilt one', async () => {
  const { second, parent, pr, first } = await secondInBuild()
  await actions.replanEpic(payload, second, 'two needs another shape')
  await actions.replanEpic(payload, second, 'two needs another shape')
  expect(await reload(parent.id)).toMatchObject({ stage: 'plan' })
  expect((await commentsOf(parent.number)).join('\n')).toContain('1. One (built)')
  await replanned(parent, PLAN(['One', 'Two b', 'Two c', 'Four']).replace('- **Two b** — body 1.\n  after: One', '- **Two b** — new body.'))
  expect(await actions.advancePlan(payload, await reload(parent.id))).toBe('parent')
  const after = await reload(parent.id)
  expect(after).toMatchObject({ stage: 'parent' })
  expect(after.epic).toMatchObject({ current: 1, mergeFailures: 0 })
  expect(after.epic.slices.map((s: Doc) => s.title)).toEqual(['One', 'Two b', 'Two c', 'Four'])
  expect(after.epic.slices[0].ticket).toBe(first.id)
  const subs = await kids(parent.id)
  expect(subs.map((s) => [s.title, s.state])).toEqual([['One', 'open'], ['Two', 'closed'], ['Two b', 'open']])
  expect(subs[2]).toMatchObject({ slice: { index: 1, prev: pr.headSha, passed: false }, inheritedApprovalFrom: parent.id })
  expect(after.epic.slices[1].ticket).toBe(subs[2]!.id)
  const log = await worklogOf(parent.number)
  expect(log).toContain('Re-plan accepted. Before: 1. One (built); 2. Two; 3. Three. After: 1. One (built); 2. Two b; 3. Two c; 4. Four.')
  expect(await actions.advanceEpics(payload)).toBe(0)
})

it('a re-plan with another Goal waits for the plan gate and is taken on approval', async () => {
  const { second, parent } = await secondInBuild()
  await actions.replanEpic(payload, second, 'x')
  await replanned(parent, PLAN(['One', 'Two b']).replace('- g', '- a bigger goal'))
  expect(await actions.advancePlan(payload, await reload(parent.id))).toBeNull()
  expect(await reload(parent.id)).toMatchObject({ stage: 'plan' })
  expect(await sliceTitles(parent.id)).toEqual(['One', 'Two', 'Three'])
  expect(await actions.spawnSubTickets(payload, await reload(parent.id))).toBe(true)
  expect(await reload(parent.id)).toMatchObject({ stage: 'parent' })
  expect(await sliceTitles(parent.id)).toEqual(['One', 'Two b'])
})

it('a plan that changes or drops a built slice is refused with a reason, once, and the epic stays as it was', async () => {
  const { second, parent } = await secondInBuild()
  await actions.replanEpic(payload, second, 'x')
  await replanned(parent, PLAN(['One changed', 'Two b']))
  expect(await actions.advancePlan(payload, await reload(parent.id))).toBe('refused')
  expect(await actions.advancePlan(payload, await reload(parent.id))).toBe('refused')
  const refusals = (await commentsOf(parent.number)).filter((c) => c.includes('bauherr:replan-refused'))
  expect(refusals).toHaveLength(1)
  expect(refusals[0]).toContain('built slice 1 "One" is changed or moved')
  expect(await reload(parent.id)).toMatchObject({ stage: 'plan' })
  expect(await sliceTitles(parent.id)).toEqual(['One', 'Two', 'Three'])
  await replanned(parent, PLAN(['One']))
  expect(await actions.spawnSubTickets(payload, await reload(parent.id))).toBe(true)
  expect(await sliceTitles(parent.id)).toEqual(['One', 'Two', 'Three'])
  expect((await commentsOf(parent.number)).join('\n')).toContain('the plan leaves none to build')
})

it('the second merge failure of a slice sends the epic back to plan with the reason; one does not; a passing slice resets the count', async () => {
  await unlimited()
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  await (await gate(first!)).run()
  const second = (await kids(parent.id))[1]!
  await payload.update({ collection: 'tickets', id: parent.id, data: { epic: { ...(await reload(parent.id)).epic, mergeFailures: 1 } }, ...o })
  await actions.noteMergeFailure(payload, second)
  expect(await reload(parent.id)).toMatchObject({ stage: 'plan', epic: { mergeFailures: 0 } })
  expect(await reload(second.id)).toMatchObject({ state: 'closed' })
  expect(await worklogOf(parent.number)).toContain('merging the base branch into the epic branch failed 2 times at slice 2')
  expect(pr.number).toBeGreaterThan(0)

  const other = await split()
  await openEpicPr(other)
  const [one] = await kids(other.id)
  await actions.noteMergeFailure(payload, one!)
  expect(await reload(other.id)).toMatchObject({ stage: 'parent', epic: { mergeFailures: 1 } })
  expect((await reload(one!.id)).state).toBe('open')
  await (await gate(one!)).run()
  expect((await reload(other.id)).epic.mergeFailures).toBe(0)
})

it('a parent that enters review later through pullWaiting (Review was full) still gets the merge-main step, once', async () => {
  const { pullWaiting } = await import('../src/lib/wip')
  await unlimited()
  const parent = await split(['One'])
  await openEpicPr(parent)
  await payload.update({ collection: 'tickets', id: parent.id, data: { waitingFor: 'review', reviewState: null }, ...o })
  const before = await mergeJobs()
  await pullWaiting(payload)
  expect(await reload(parent.id)).toMatchObject({ stage: 'review', waitingFor: null, reviewState: 'waiting_checks' })
  expect(await mergeJobs()).toBe(before + 1)
  await pullWaiting(payload)
  expect(await mergeJobs()).toBe(before + 1)
})

/** Latest Run of `ticket`, or a fresh one when the test needs a live Run to cancel. */
const liveRun = (ticket: Doc, stage: string, status = 'running') => payload.create({ collection: 'runs', data: { ticket: ticket.id, stage, status, mode: 'session', workspace: ws, kind: stage === 'plan' || stage === 'build' || stage === 'review' ? stage : undefined }, ...o })
const runStatus = async (id: number | string) => (await payload.findByID({ collection: 'runs', id, depth: 0, ...o })).status

it('park cancels the live Run, parks the parent and its open slices, logs history and the epic worklog; a second park is a no-op', async () => {
  await unlimited()
  const parent = await split()
  const [first] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'build' }, ...o })
  const run = await liveRun(first!, 'build')
  await actions.parkEpic(payload, owner, { ticket: parent.id })
  expect(await runStatus(run.id)).toBe('cancelled')
  expect(await reload(parent.id)).toMatchObject({ parked: true, state: 'open', stage: 'parent' })
  expect(await reload(first!.id)).toMatchObject({ parked: true, state: 'open' })
  expect(await worklogOf(parent.number)).toContain('Epic parked')
  const events = (await payload.find({ collection: 'ticket_events', where: { and: [{ ticket: { equals: parent.id } }, { cause: { equals: 'epic:park' } }] }, ...o })).docs
  expect(events).toHaveLength(1)
  await expect(actions.parkEpic(payload, owner, { ticket: parent.id })).rejects.toThrow('parked already')
  expect(await actions.parkEpicNow(payload, await reload(parent.id), { by: 'x', executor: 'human', why: 'again' })).toBe(false)
  expect(await payload.count({ collection: 'ticket_events', where: { and: [{ ticket: { equals: parent.id } }, { cause: { equals: 'epic:park' } }] }, ...o }).then((r) => r.totalDocs)).toBe(1)
})

it('a parked epic is skipped by the poll sweep, the claim order and run starts; the parked slice holds no WIP', async () => {
  const { wipCount } = await import('../src/lib/wip')
  await unlimited()
  const parent = await split()
  const [first] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'build' }, ...o })
  const { callTool } = await import('../src/lib/mcp-tools')
  const frontier = async () => ((await callTool({ payload, user: owner, actor: { kind: 'human' } as never }, 'list_frontier', {})) as { number: number }[]).map((t) => t.number)
  expect(await frontier()).toContain(first!.number)
  const before = await wipCount(payload, ws, 'build')
  await actions.parkEpic(payload, owner, { ticket: parent.id })
  expect(await wipCount(payload, ws, 'build')).toBe(before - 1)
  expect(await frontier()).not.toContain(first!.number)
  // The slice passed while parked: the sweep does not create the next one.
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'done', slice: { ...first!.slice, head: 'abc', passed: true } }, ...o })
  expect(await actions.advanceEpics(payload)).toBe(0)
  expect(await actions.advanceEpic(payload, await reload(parent.id))).toBe(false)
  expect(await kids(parent.id)).toHaveLength(1)
})

it('resume continues where it stopped: the cancelled Build starts again, and a passed slice moves the epic on', async () => {
  await unlimited()
  const parent = await split()
  const [first] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'build' }, ...o })
  const run = await liveRun(first!, 'build')
  await actions.parkEpic(payload, owner, { ticket: parent.id })
  expect(await runStatus(run.id)).toBe('cancelled')
  await actions.resumeEpic(payload, owner, { ticket: parent.id })
  expect(await reload(parent.id)).toMatchObject({ parked: false })
  expect(await reload(first!.id)).toMatchObject({ parked: false })
  const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: first!.id } }, sort: 'createdAt', ...o })).docs
  expect(runs.map((r) => r.status)).toEqual(['cancelled', 'awaiting_session'])
  expect(await worklogOf(parent.number)).toContain('Epic resumed')
  await expect(actions.resumeEpic(payload, owner, { ticket: parent.id })).rejects.toThrow('not parked')

  // Parked while the slice passed: resuming creates the next slice.
  const other = await split()
  const [one] = await kids(other.id)
  await actions.parkEpic(payload, owner, { ticket: other.id })
  await payload.update({ collection: 'tickets', id: one!.id, data: { stage: 'done', slice: { ...one!.slice, head: 'abc', passed: true } }, ...o })
  await actions.resumeEpic(payload, owner, { ticket: other.id })
  expect((await kids(other.id)).map((k) => k.title)).toEqual(['One', 'Two'])
})

it('stop at the review round cap parks an epic slice and an epic parent, but still sends a normal ticket to triage', async () => {
  await unlimited()
  const parent = await split()
  const [first] = await kids(parent.id)
  await payload.update({ collection: 'tickets', id: first!.id, data: { stage: 'review', reviewState: 'needs_human', reviewRounds: 3 }, ...o })
  await openEpicPr(parent)
  await actions.stopReview(payload, owner, { ticket: first!.id, note: 'redesign' })
  expect(await reload(first!.id)).toMatchObject({ parked: true, stage: 'review' })
  expect(await reload(parent.id)).toMatchObject({ parked: true, stage: 'parent' })
  expect((await commentsOf(first!.number)).join('\n')).toContain('The epic is parked')

  // Epic review on the parent itself.
  const p2 = await split(['Only'])
  const pr = await openEpicPr(p2)
  await payload.update({ collection: 'tickets', id: p2.id, data: { stage: 'review', reviewState: 'needs_human', reviewRounds: 3 }, ...o })
  await actions.stopReview(payload, owner, { ticket: p2.id })
  expect(await reload(p2.id)).toMatchObject({ parked: true, stage: 'review' })
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('open')

  // A ticket that is no epic keeps the old behaviour.
  const issue = await fake.tickets(repo).create({ title: 'plain', labels: ['bauherr:stage:review'] })
  const plain = await payload.create({ collection: 'tickets', data: { title: 'plain', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', labels: issue.labels, stage: 'review', reviewState: 'needs_human', reviewRounds: 3, product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'p.ts', 'x')
  const ppr = await fake.forge.openPullRequest(repo, { title: 'plain', body: EVIDENCE, head: branch, base: 'main' })
  await payload.create({ collection: 'runs', data: { ticket: plain.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: ppr.url } }, ...o })
  await actions.stopReview(payload, owner, { ticket: plain.id })
  expect(await reload(plain.id)).toMatchObject({ stage: 'triage', parked: false })
})

it('a parked epic is not merged: no review conclusion, no merge-main, no review restart', async () => {
  const { startReviewIfReady } = await import('../src/jobs')
  const parent = await split(['Only'])
  const pr = await openEpicPr(parent)
  await payload.update({ collection: 'tickets', id: parent.id, data: { stage: 'review', reviewState: 'waiting_checks' }, ...o })
  await actions.parkEpic(payload, owner, { ticket: parent.id })
  expect(await actions.watchReviews(payload)).toBe(0)
  const t = await reload(parent.id)
  expect(await actions.concludeReview(payload, parent.id, { verdict: 'clean', findings: [], markdown: 'm', open: [] } as never, pr.headSha)).toEqual({ outcome: 'noop' })
  expect(await startReviewIfReady(payload, { ...t, reviewState: null })).toBeNull()
  await mergeMain.mergeMainIntoMr(payload, parent.id, null)
  expect(await reload(parent.id)).toMatchObject({ stage: 'review', reviewState: 'waiting_checks', conflictReturns: 0 })
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('open')
})

it('discard closes the epic PR unmerged, deletes the epic branch and closes the parent and open slices as not planned', async () => {
  await unlimited()
  const parent = await split()
  const pr = await openEpicPr(parent)
  const [first] = await kids(parent.id)
  const run = await liveRun(first!, 'build')
  await actions.parkEpic(payload, owner, { ticket: parent.id })
  await actions.discardEpic(payload, owner, { ticket: parent.id })
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('closed')
  expect(await fake.forge.getBranch(repo, parent.epic.branch)).toBeNull()
  expect(await runStatus(run.id)).toBe('cancelled')
  for (const t of [parent, first!]) {
    expect(await reload(t.id)).toMatchObject({ state: 'closed' })
    expect(await forgeIssue(t.number)).toMatchObject({ state: 'closed', closeReason: 'not_planned' })
  }
  expect(await worklogOf(parent.number)).toContain('Epic discarded')
  await expect(actions.discardEpic(payload, owner, { ticket: parent.id })).rejects.toThrow('nothing to discard')
})

it('a parent closed as not planned closes its open slices as not planned, an accepted one as completed', async () => {
  const parent = await split(['One'])
  const [first] = await kids(parent.id)
  await fake.tickets(repo).close(String(parent.number), 'not_planned')
  await payload.update({ collection: 'tickets', id: parent.id, data: { state: 'closed' }, ...o })
  await actions.advanceEpics(payload)
  expect(await reload(first!.id)).toMatchObject({ state: 'closed' })
  expect(await forgeIssue(first!.number)).toMatchObject({ state: 'closed', closeReason: 'not_planned' })
})

it('only a Bauherr or Admin can park, resume or discard; a Product owner is refused and nothing changes', async () => {
  const parent = await split(['One'])
  for (const act of [actions.parkEpic, actions.resumeEpic, actions.discardEpic]) await expect(act(payload, productOwner, { ticket: parent.id })).rejects.toThrow('Only a Bauherr or Admin')
  expect(await reload(parent.id)).toMatchObject({ parked: false, state: 'open' })
  await expect(actions.parkEpic(payload, owner, { ticket: (await kids(parent.id))[0]!.id })).rejects.toThrow('not an epic')
})
