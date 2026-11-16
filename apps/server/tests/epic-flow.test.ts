import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
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
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const EVIDENCE = 'Refs it\n\n## Evidence\n| Goal | verified |\n'
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
