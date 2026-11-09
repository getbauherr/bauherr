import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let queueProduct: number
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
let mergeMode: typeof import('../src/lib/merge-mode')
const o = { overrideAccess: true } as const
const repo = 'acme/queue'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const clean = { verdict: 'clean' as const, findings: [], markdown: '**Verdict**: clean' }
const minutes = (n: number) => Date.now() + n * 60_000

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('merge_queue')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  release = await import('../src/lib/release')
  mergeMode = await import('../src/lib/merge-mode')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  fake.setQueueSupport(repo, true)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  queueProduct = (await payload.create({ collection: 'products', data: { name: 'queue', slug: 'queue', workspace: ws, mergeMode: 'queue' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product: queueProduct, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** Every test starts with an empty queue and no queued Ticket of an earlier test. */
beforeEach(async () => {
  for (const p of await fake.forge.listPullRequests(repo, 'all')) await fake.forge.dequeuePullRequest(repo, p.number)
  await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`UPDATE "tickets" SET "review_state" = NULL, "state" = 'closed' WHERE "review_state" = 'queued'`)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
/** A review Ticket with an open factory MR, green checks and a succeeded Review Run on the MR head. */
const seed = async () => {
  const issue = await fake.tickets(repo).create({ title: 'queue me', labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'queue me', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product: queueProduct, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 'queue me', body: 'Done\n\n## Evidence\n| Goal | verified |\n', head: branch, base: 'main' })
  fake.setChecks(repo, pr.headSha, green)
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'review', status: 'succeeded', mode: 'session', workspace: ws, reviewedSha: pr.headSha, verdict: 'clean' }, ...o })
  return { id: t.id as number, pr, branch, n: String(issue.number) }
}
const conclude = (id: number, sha: string) => actions.concludeReview(payload, id, clean, sha)
const enqueued = async () => {
  const s = await seed()
  expect(await conclude(s.id, s.pr.headSha)).toEqual({ outcome: 'queued' })
  return s
}

it('queue mode enqueues the reviewed head pinned and the Ticket is queued, not merged', async () => {
  const seen: string[] = []
  const enqueue = fake.forge.enqueuePullRequest
  fake.forge.enqueuePullRequest = async (r, n, opts) => (seen.push(opts.expectSha), enqueue(r, n, opts))
  try {
    const { id, pr } = await enqueued()
    expect(seen).toEqual([pr.headSha])
    expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'queued' })
    expect((await reload(id)).queuedAt).toBeTruthy()
    expect(await fake.forge.isQueued(repo, pr.number)).toBe(true)
    expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('open')
  } finally {
    fake.forge.enqueuePullRequest = enqueue
  }
})

it('a PR behind its base is enqueued, not merged with the base by the Runner', async () => {
  const s = await seed()
  fake.setBehind(repo, s.pr.number, true)
  expect(await conclude(s.id, s.pr.headSha)).toEqual({ outcome: 'queued' })
})

it('a merge by the queue moves the Ticket to release with the merge sha of the PR', async () => {
  const { id, pr } = await enqueued()
  expect(await actions.watchQueued(payload)).toBe(0)
  expect((await reload(id)).reviewState).toBe('queued')
  expect(fake.advanceQueue(repo)).toBe(pr.number)
  expect(await actions.watchQueued(payload)).toBe(1)
  expect((await reload(id)).reviewState).toBe('merged')
  // a queue merge queues the skill distillation like the direct gate's merge (#41)
  expect(await payload.count({ collection: 'payload-jobs' as never, where: { concurrencyKey: { equals: `distill:${id}` } } as never, overrideAccess: true })).toMatchObject({ totalDocs: 1 })
  expect(await release.watchRelease(payload)).toMatchObject({ released: 1 })
  expect(await reload(id)).toMatchObject({ stage: 'release', mergeSha: (await fake.forge.getPullRequest(repo, pr.number)).mergeSha })
})

it('a PR dropped by the queue returns to Build with the queue-run link and counts a train failure', async () => {
  const { id, pr, n } = await enqueued()
  fake.advanceQueue(repo, { fail: [pr.number] })
  expect(await actions.watchQueued(payload, Date.now())).toBe(0)
  expect((await reload(id)).reviewState).toBe('queued')
  await actions.watchQueued(payload, minutes(3))
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewState: null, trainFailures: 1 })
  const worklog = (await fake.tickets(repo).listComments(n)).find((c) => c.body.startsWith('<!-- bauherr:worklog -->'))!.body
  expect(worklog).toContain('https://github.com/acme/queue/actions?query=event%3Amerge_group')
})

it('a merge landing between the PR read and the queue check is not a drop', async () => {
  const { id, pr } = await enqueued()
  const isQueued = fake.forge.isQueued
  fake.forge.isQueued = async (r, n) => (fake.advanceQueue(repo), isQueued(r, n))
  try {
    expect(await actions.watchQueued(payload, minutes(3))).toBe(1)
  } finally {
    fake.forge.isQueued = isQueued
  }
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'merged', trainFailures: 0 })
  expect((await fake.forge.getPullRequest(repo, pr.number)).state).toBe('merged')
})

it('the 3rd drop needs a human', async () => {
  const { id, pr } = await enqueued()
  await payload.update({ collection: 'tickets', id, data: { trainFailures: 2 }, ...o })
  fake.advanceQueue(repo, { fail: [pr.number] })
  await actions.watchQueued(payload, minutes(3))
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', trainFailures: 3 })
})

it('a moved head dequeues the PR and starts a new review', async () => {
  const { id, pr, branch } = await enqueued()
  fake.commit(repo, branch, 'b.ts', 'y')
  await actions.watchQueued(payload)
  expect(await fake.forge.isQueued(repo, pr.number)).toBe(false)
  expect((await reload(id)).reviewState).toBeNull()
  const runs = (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'review' } }, { status: { in: ['queued', 'awaiting_session', 'running'] } }] }, depth: 0, ...o })).docs
  expect(runs).toHaveLength(1)
})

it('queued for more than two hours needs a human and leaves the queue', async () => {
  const { id, pr } = await enqueued()
  await actions.watchQueued(payload, minutes(121))
  expect(await reload(id)).toMatchObject({ reviewState: 'needs_human' })
  expect(await fake.forge.isQueued(repo, pr.number)).toBe(false)
})

it('dequeueBeforeChange takes the PR out of the queue before anything pushes to it, and is idempotent', async () => {
  const { id, pr } = await enqueued()
  const mr = await release.prOf(payload, await reload(id))
  await mergeMode.dequeueBeforeChange(payload, await reload(id), mr!)
  await mergeMode.dequeueBeforeChange(payload, await reload(id), mr!)
  expect(await fake.forge.isQueued(repo, pr.number)).toBe(false)
  expect(await reload(id)).toMatchObject({ reviewState: 'waiting_checks' })
  expect((await reload(id)).queuedAt).toBeNull()
})

it('a forge that refuses the enqueue counts as a failed merge and keeps the Ticket waiting', async () => {
  const s = await seed()
  fake.setQueueSupport(repo, false)
  try {
    expect(await conclude(s.id, s.pr.headSha)).toEqual({ outcome: 'waiting_checks' })
  } finally {
    fake.setQueueSupport(repo, true)
  }
  expect(await reload(s.id)).toMatchObject({ reviewState: 'waiting_checks', mergeFailures: 1 })
})

it('Re-detect stores the detected mode and its preflight; a failing forge keeps the mode and stores the problem', async () => {
  const { redetectMergeMode } = await import('../src/lib/merge-preflight')
  const product = async () => (await payload.findByID({ collection: 'products', id: queueProduct, depth: 0, ...o })) as Record<string, any>
  await payload.update({ collection: 'products', id: queueProduct, data: { mergeMode: 'direct' }, ...o })
  await redetectMergeMode(payload, queueProduct)
  expect(await product()).toMatchObject({ mergeMode: 'queue', mergePreflight: { ok: true, problems: [] } })
  fake.commit(repo, 'main', '.github/workflows/ci.yml', 'on:\n  pull_request:\n  push:\njobs:\n  ci:\n    steps: []\n')
  fake.setRequiredChecks(repo, ['ci'])
  await redetectMergeMode(payload, queueProduct)
  expect(await product()).toMatchObject({ mergeMode: 'train', mergePreflight: { ok: false, problems: [expect.stringContaining('merge_group')] } })
  const queueSupport = fake.forge.queueSupport
  fake.forge.queueSupport = async () => {
    throw new Error('GitHub GraphQL: boom')
  }
  try {
    await redetectMergeMode(payload, queueProduct)
  } finally {
    fake.forge.queueSupport = queueSupport
  }
  expect(await product()).toMatchObject({ mergeMode: 'train', mergePreflight: { ok: false, problems: [expect.stringContaining('boom')] } })
})
