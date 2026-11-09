import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const scan = vi.hoisted(() => ({ hang: false }))
vi.mock('../src/lib/liveness', async (orig) => {
  const real = await orig<typeof import('../src/lib/liveness')>()
  return { ...real, invisibleDead: (...a: Parameters<typeof real.invisibleDead>) => (scan.hang ? new Promise<never>(() => {}) : real.invisibleDead(...a)) }
})

let payload: Payload
let fake: FakeBackend
let product: number
let ws: number
let actions: typeof import('../src/lib/actions')
let release: typeof import('../src/lib/release')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const check = (id: number, conclusion: string | null, status = conclusion ? 'completed' : 'in_progress') => ({ id, runId: 7, name: 'ci', status, conclusion, url: `https://fake/run/${id}` })
const EVIDENCE = 'Closes it\n\n## Evidence\n| Goal | verified |\n'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('check_retry')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** A review Ticket with an open factory MR whose head has `checks`. */
const seed = async (checks: any[]) => {
  const issue = await fake.tickets(repo).create({ title: 'retry me', labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'retry me', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'review', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-feat`
  await fake.forge.createBranch(repo, branch)
  fake.commit(repo, branch, 'a.ts', 'x')
  const pr = await fake.forge.openPullRequest(repo, { title: 'retry me', body: EVIDENCE, head: branch, base: 'main' })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  fake.setChecks(repo, pr.headSha, checks)
  return { id: t.id as number, n: String(issue.number), pr }
}
const gate = async (id: number, sha: string) => {
  const t = (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
  return actions.mergeGate(payload, t, (await release.prOf(payload, t))!, sha)
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const rows = async (id: number) => (await payload.find({ collection: 'check_flakes', where: { ticket: { equals: id } }, ...o })).docs as Record<string, any>[]
const reruns = () => fake.reruns(repo).length
const setRetries = (checkRetries: number) => payload.update({ collection: 'products', id: product, data: { checkRetries }, ...o })

it('fail then pass: the gate waits without a round or Build Run, then merges and logs a flake', async () => {
  const { id, n, pr } = await seed([check(1, 'failure')])
  fake.setRerunChecks(repo, pr.headSha, [check(2, null)])
  const before = reruns()
  expect(await gate(id, pr.headSha)).toBe('waiting_checks')
  expect(reruns()).toBe(before + 1)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewState: 'waiting_checks', reviewRounds: 0 })
  expect((await rows(id)).map((r) => r.outcome)).toEqual(['pending'])
  expect((await fake.tickets(repo).listComments(n)).filter((c) => c.body.includes('retried once'))).toHaveLength(1)
  expect(await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }, { status: { equals: 'awaiting_session' } }] }, ...o })).toMatchObject({ totalDocs: 0 })
  fake.setChecks(repo, pr.headSha, [check(2, 'success')])
  expect(await gate(id, pr.headSha)).toBe('merged')
  expect((await rows(id)).map((r) => r.outcome)).toEqual(['flake'])
})

it('fail twice: a re-run that is not listed yet waits, a second red returns to Build with a round and no second re-run', async () => {
  const { id, pr } = await seed([check(1, 'failure')])
  const before = reruns()
  expect(await gate(id, pr.headSha)).toBe('waiting_checks')
  expect(await gate(id, pr.headSha)).toBe('waiting_checks')
  expect(reruns()).toBe(before + 1)
  fake.setChecks(repo, pr.headSha, [check(2, 'failure')])
  expect(await gate(id, pr.headSha)).toBe('build')
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewRounds: 1 })
  expect((await rows(id)).map((r) => r.outcome)).toEqual(['failed'])
  expect(reruns()).toBe(before + 1)
})

it('a failed check whose workflow run is still in progress waits without claiming or re-running', async () => {
  const { id, pr } = await seed([check(1, 'failure'), { id: 5, runId: 7, name: 'e2e', status: 'in_progress', conclusion: null }])
  const before = reruns()
  expect(await gate(id, pr.headSha)).toBe('waiting_checks')
  expect(reruns()).toBe(before)
  expect(await rows(id)).toHaveLength(0)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewRounds: 0 })
})

it('a lost claim race waits instead of returning to Build', async () => {
  const { id, pr } = await seed([check(1, 'failure')])
  const before = reruns()
  const spy = vi.spyOn(payload, 'create').mockRejectedValueOnce(new Error('duplicate key'))
  try {
    expect(await gate(id, pr.headSha)).toBe('waiting_checks')
  } finally {
    spy.mockRestore()
  }
  expect(reruns()).toBe(before)
  expect(await reload(id)).toMatchObject({ stage: 'review', reviewRounds: 0 })
})

it('checkRetries accepts 0 and 1 only', async () => {
  await expect(setRetries(2)).rejects.toThrow()
  await expect(setRetries(1)).resolves.toBeTruthy()
})

it('checkRetries 0 returns to Build at once without a re-run', async () => {
  await setRetries(0)
  try {
    const { id, pr } = await seed([check(1, 'failure')])
    const before = reruns()
    expect(await gate(id, pr.headSha)).toBe('build')
    expect(reruns()).toBe(before)
    expect(await rows(id)).toHaveLength(0)
  } finally {
    await setRetries(1)
  }
})

it('a check the forge cannot re-run behaves as today', async () => {
  const { id, pr } = await seed([{ name: 'ci', status: 'completed', conclusion: 'failure' }])
  expect(await gate(id, pr.headSha)).toBe('build')
  expect(await reload(id)).toMatchObject({ stage: 'build', reviewRounds: 1 })
  expect(await rows(id)).toHaveLength(0)
})

it('Factory health lists the flaky checks of the Workspace by count', async () => {
  const mk = async (checkName: string, outcome: string, ago = 0) => {
    const { id } = await seed([])
    await payload.create({ collection: 'check_flakes', data: { workspace: ws, ticket: id, checkName, sha: `s${Math.random()}`, outcome, createdAt: new Date(Date.now() - ago * 864e5).toISOString() }, ...o } as never)
  }
  await mk('lint', 'flake'); await mk('e2e', 'flake'); await mk('e2e', 'flake'); await mk('e2e', 'failed'); await mk('old', 'flake', 40)
  const { loadHealth } = await import('../src/app/(app)/lib/settings')
  const ours = (await loadHealth(ws)).flakes.filter((f) => ['lint', 'e2e', 'old'].includes(f.check))
  expect(ours.map((f) => [f.check, f.count])).toEqual([['e2e', 2], ['lint', 1]])
})

it('Factory health reports the dead-Ticket scan as unavailable when it times out, never as zero', async () => {
  const { loadHealth } = await import('../src/app/(app)/lib/settings')
  expect((await loadHealth(ws)).dead).toEqual([])
  scan.hang = true
  try {
    expect((await loadHealth(ws, 50)).dead).toBeNull()
  } finally {
    scan.hang = false
  }
})

it('an e2e-flaky check run records one flake row per listed test, once', async () => {
  const output = JSON.stringify([{ shard: '1', file: 'a.spec.ts', title: 'one' }, { shard: '1', file: 'b.spec.ts', title: 'two' }])
  const { id, pr } = await seed([check(1, 'success'), { id: 9, name: 'e2e-flaky (shard 1)', status: 'completed', conclusion: 'neutral', url: 'https://fake/run/9', output }])
  await gate(id, pr.headSha)
  await gate(id, pr.headSha)
  const r = await rows(id)
  expect(r.map((x) => x.checkName).sort()).toEqual(['e2e: a.spec.ts › one', 'e2e: b.spec.ts › two'])
  expect(r.every((x) => x.outcome === 'flake')).toBe(true)
})
