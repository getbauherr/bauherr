import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let actions: typeof import('../src/lib/actions')
let trains: typeof import('../src/lib/train')
const o = { overrideAccess: true } as const
const repo = 'acme/train'
const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }]
const redRun = 'https://github.com/acme/train/actions/runs/9'
const red = [{ name: 'ci', status: 'completed', conclusion: 'failure', url: redRun }]
const clean = { verdict: 'clean' as const, findings: [], markdown: '**Verdict**: clean' }

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('train')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  trains = await import('../src/lib/train')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'train', slug: 'train', workspace: ws, mergeMode: 'train' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** Every test starts without a running train and without Tickets of an earlier test in the queue. */
beforeEach(async () => {
  const { sql } = await import('@payloadcms/db-postgres')
  await payload.db.drizzle.execute(sql`UPDATE "products" SET "train_state" = NULL WHERE "id" = ${product}`)
  await payload.db.drizzle.execute(sql`UPDATE "tickets" SET "review_state" = NULL, "state" = 'closed' WHERE "review_state" = 'queued'`)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const state = async () => ((await payload.findByID({ collection: 'products', id: product, depth: 0, ...o })) as Record<string, any>).trainState as import('../src/lib/train').TrainState | null
/** A queued review Ticket whose factory MR adds `file`; the merge gate marks it queued without calling the forge. */
const seed = async (file: string, content = 'x') => {
  const issue = await fake.tickets(repo).create({ title: `train ${file}`, labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title: `train ${file}`, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, file, content)
  const pr = await fake.forge.openPullRequest(repo, { title: 'train', body: 'Done\n\n## Evidence\n| Goal | verified |\n', head: branch, base: 'main' })
  fake.setChecks(repo, pr.headSha, green)
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'review', status: 'succeeded', mode: 'session', workspace: ws, reviewedSha: pr.headSha, verdict: 'clean' }, ...o })
  expect(await actions.concludeReview(payload, t.id as number, clean, pr.headSha)).toEqual({ outcome: 'queued' })
  expect(await fake.forge.isQueued(repo, pr.number)).toBe(false)
  return { id: t.id as number, pr, n: String(issue.number) }
}
const merges: [number, string | undefined][] = []
const resets: string[] = []
const spy = () => {
  merges.length = resets.length = 0
  const merge = fake.forge.mergePullRequest
  fake.forge.mergePullRequest = async (r, n, opts) => (merges.push([n, opts.expectSha]), merge(r, n, opts))
  const reset = fake.forge.resetBranch
  fake.forge.resetBranch = async (r, b, sha) => (resets.push(sha), reset(r, b, sha))
  return () => Object.assign(fake.forge, { mergePullRequest: merge, resetBranch: reset })
}
const settle = async (checks: typeof green) => fake.setChecks(repo, (await state())!.tip, checks)
const run = () => trains.runTrains(payload)

it('3 green PRs are tested together and merge in order, each pinned to its head', async () => {
  const restore = spy()
  try {
    const s = [await seed('a.ts'), await seed('b.ts'), await seed('c.ts')]
    await run()
    expect((await state())!.members.map((m) => m.pr)).toEqual(s.map((x) => x.pr.number))
    expect((await fake.forge.getBranch(repo, 'bauherr/train'))!.sha).toBe((await state())!.tip)
    await run()
    expect(merges).toEqual([])
    await settle(green)
    await run()
    expect(merges).toEqual(s.map((x) => [x.pr.number, x.pr.headSha]))
    expect(await state()).toBeNull()
    expect(await actions.watchQueued(payload)).toBe(3)
    for (const x of s) expect(await reload(x.id)).toMatchObject({ reviewState: 'merged' })
  } finally {
    restore()
  }
})

it('PR 2 of 3 red: bisect takes 2 extra runs, PR 2 returns with the check link, PR 1 merges, PR 3 merges after a re-train', async () => {
  const restore = spy()
  try {
    const [p1, p2, p3] = [await seed('a.ts'), await seed('b.ts'), await seed('c.ts')]
    await run()
    await settle(red)
    await run()
    expect((await state())).toMatchObject({ phase: 'bisect', probe: 1 })
    await settle(green)
    await run()
    expect((await state())).toMatchObject({ phase: 'bisect', probe: 2 })
    expect(resets).toHaveLength(3)
    await settle(red)
    await run()
    expect(merges).toEqual([[p1.pr.number, p1.pr.headSha]])
    expect(await reload(p2.id)).toMatchObject({ stage: 'build', reviewState: null, trainFailures: 1 })
    expect((await fake.tickets(repo).listComments(p2.n)).find((c) => c.body.startsWith('<!-- bauherr:worklog -->'))!.body).toContain(redRun)
    expect((await state())!.members.map((m) => m.pr)).toEqual([p3.pr.number])
    await settle(green)
    await run()
    expect(merges).toEqual([[p1.pr.number, p1.pr.headSha], [p3.pr.number, p3.pr.headSha]])
    expect(await state()).toBeNull()
  } finally {
    restore()
  }
})

it('a PR that conflicts with the train returns to Build; the others are tested', async () => {
  const p1 = await seed('a.ts', 'one')
  const p2 = await seed('a.ts', 'two')
  await run()
  expect(await reload(p2.id)).toMatchObject({ stage: 'build', reviewState: null, conflictReturns: 1 })
  expect((await state())!.members.map((m) => m.pr)).toEqual([p1.pr.number])
})

it('main moving under a running train rebuilds it on the new main without merging', async () => {
  const restore = spy()
  try {
    const [p1, p2] = [await seed('a.ts'), await seed('b.ts')]
    await run()
    const before = (await state())!
    await settle(green)
    fake.commit(repo, 'main', 'x.ts', 'moved')
    await run()
    expect(merges).toEqual([])
    const after = (await state())!
    expect(after.baseSha).toBe((await fake.forge.getBranch(repo, 'main'))!.sha)
    expect(after.baseSha).not.toBe(before.baseSha)
    expect(after.tip).not.toBe(before.tip)
    expect(after.members.map((m) => m.pr)).toEqual([p1.pr.number, p2.pr.number])
  } finally {
    restore()
  }
})

it('the 3rd train failure of a Ticket needs a human', async () => {
  const p = await seed('a.ts')
  await payload.update({ collection: 'tickets', id: p.id, data: { trainFailures: 2 }, ...o })
  await run()
  await settle(red)
  await run()
  expect(await reload(p.id)).toMatchObject({ stage: 'review', reviewState: 'needs_human', trainFailures: 3 })
  expect(await state()).toBeNull()
})

it('bisectFirstFailure finds the first failing prefix for k = 1..5 with at most ceil(log2 k) probes', async () => {
  for (let k = 1; k <= 5; k++) {
    for (let first = 1; first <= k; first++) {
      const probes: number[] = []
      const found = await trains.bisectFirstFailure(k, async (m) => (probes.push(m), m < first))
      expect(found, `k=${k} first=${first}`).toBe(first)
      expect(probes.length).toBeLessThanOrEqual(Math.ceil(Math.log2(k)))
      expect(probes.every((m) => m >= 1 && m < k)).toBe(true)
    }
  }
})
