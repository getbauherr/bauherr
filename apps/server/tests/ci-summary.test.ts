import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let product: number
let ws: number
const o = { overrideAccess: true, depth: 0 } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('ci_summary')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const ticket = (number: number, stage: string) => payload.create({ collection: 'tickets', data: { title: `t${number}`, externalId: `c${number}`, number, state: 'open', labels: [], stage, product, workspace: ws }, ...o })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, ...o })) as Record<string, any>
const openPr = async (number: number) => {
  const head = `bauherr/${number}-1`
  await fake.forge.createBranch(repo, head)
  fake.commit(repo, head, 'a.txt', 'x')
  return fake.forge.openPullRequest(repo, { title: 't', body: 'b', head, base: 'main' })
}

it('stores the latest run per check, the counts, the failing names and the MR link; clears it when the MR closes', async () => {
  const { storeCiSummaries, ciSummaryOf } = await import('../src/lib/ci-summary')
  const t = await ticket(1, 'build')
  const pr = await openPr(1)
  fake.setChecks(repo, pr.headSha, [
    { id: 1, name: 'lint', status: 'completed', conclusion: 'success' },
    { id: 2, name: 'e2e', status: 'in_progress', conclusion: null },
    { id: 3, name: 'unit', status: 'completed', conclusion: 'failure' },
    { id: 4, name: 'unit', status: 'completed', conclusion: 'failure' },
  ])
  expect(await storeCiSummaries(payload)).toBe(1)
  const row = await reload(t.id as number)
  expect(row.ciSummary).toMatchObject({ total: 3, passed: 1, pending: 1, failed: ['unit'], url: pr.url })
  expect(row.ciSummary.rows.map((r: { name: string }) => r.name).sort()).toEqual(['e2e', 'lint', 'unit'])
  expect(ciSummaryOf(row, Date.parse(row.ciSummary.updatedAt) + 40_000)?.ageMs).toBe(40_000)

  await fake.forge.closePullRequest(repo, pr.number)
  await storeCiSummaries(payload)
  expect((await reload(t.id as number)).ciSummary).toBeNull()
})

it('a Ticket outside build and review gets no summary', async () => {
  const { storeCiSummaries } = await import('../src/lib/ci-summary')
  const t = await ticket(2, 'plan')
  const pr = await openPr(2)
  fake.setChecks(repo, pr.headSha, [{ id: 1, name: 'lint', status: 'completed', conclusion: 'success' }])
  await storeCiSummaries(payload)
  expect((await reload(t.id as number)).ciSummary ?? null).toBeNull()
})
