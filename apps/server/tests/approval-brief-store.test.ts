import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let release: typeof import('../src/lib/release')
let testDb: TestDb
const o = { overrideAccess: true } as const
const repo = 'acme/web'
const BODY = 'Refs #1\n\n## Approval brief\n### What changes for whom\n- [visible] A new card\n- [internal] A parser\n\n### Not included\n- Nothing else\n\n### Risk and rollback\nLow. Revert.\n'

beforeAll(async () => {
  testDb = await createTestDb('approval_brief')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const staged = async (title: string, body: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:release'] })
  const branch = `feat-${issue.number}`
  await fake.forge.createBranch(repo, branch)
  const pr = await fake.forge.openPullRequest(repo, { title, head: branch, base: 'main', body })
  const mergeSha = fake.merge(repo, pr.number)
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'release', product, workspace: ws, mergeSha }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  return { t, mergeSha }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>

it('freezes the brief once per merge commit and replaces it for a new one', async () => {
  const { t, mergeSha } = await staged('brief', BODY)
  const spy = vi.spyOn(fake.forge, 'getPullRequest')
  await release.publishStagingSummary(payload, await reload(t.id as number))
  const first = await reload(t.id as number)
  expect(first.approvalBrief).toMatchObject({ sha: mergeSha, notIncluded: ['Nothing else'], risk: 'Low. Revert.', changes: [{ kind: 'visible', text: 'A new card' }, { kind: 'internal', text: 'A parser' }] })
  expect(first.approvalBrief.links.map((l: { label: string }) => l.label)).toEqual(expect.arrayContaining(['Staging']))
  const calls = spy.mock.calls.length
  expect(calls).toBeGreaterThan(0)

  await payload.update({ collection: 'tickets', id: t.id, data: { approvalBrief: { ...first.approvalBrief, risk: 'edited' } }, ...o })
  await release.publishStagingSummary(payload, await reload(t.id as number))
  expect(spy.mock.calls.length).toBe(calls)
  expect((await reload(t.id as number)).approvalBrief.risk).toBe('edited')

  await payload.update({ collection: 'tickets', id: t.id, data: { mergeSha: 'fix2' }, ...o })
  await release.publishStagingSummary(payload, await reload(t.id as number))
  expect((await reload(t.id as number)).approvalBrief).toMatchObject({ sha: 'fix2', risk: 'Low. Revert.' })
  const comments = (await fake.tickets(repo).listComments(String(t.number))).map((c) => c.body)
  expect(comments.at(-1)).toContain('Approval brief')
  expect(comments.at(-1)).toContain('[visible] A new card')
  spy.mockRestore()
})

it('stores an empty brief with the no-visible-change fallback when the MR has no section', async () => {
  const { t, mergeSha } = await staged('plain', 'Refs #1\n\n## Evidence\n- ok')
  await release.publishStagingSummary(payload, await reload(t.id as number))
  const stored = (await reload(t.id as number)).approvalBrief
  expect(stored).toMatchObject({ sha: mergeSha, changes: [], notIncluded: [], risk: '' })
  const { noVisibleReason } = await import('../src/lib/approval-brief')
  expect(noVisibleReason(stored)).toBe('The merge request has no approval brief.')
})
