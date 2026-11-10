import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** The default factory with every stage renamed (fixtures/renamed-pack): triage=intake, plan=design, parent=epic, build=code, review=check, release=ship, done=shipped. Built-in behaviour binds to the stage kind, so the flow must not notice. */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let release: typeof import('../src/lib/release')
let wip: typeof import('../src/lib/wip')
let needs: typeof import('../src/app/(app)/lib/needs-you')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/renamed-pack', import.meta.url))
  testDb = await createTestDb('renamed_flow')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  release = await import('../src/lib/release')
  wip = await import('../src/lib/wip')
  needs = await import('../src/app/(app)/lib/needs-you')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws, gateOwners: 'owner', stagingUrl: 'https://staging.example' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: 'createdAt', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]

it('the renamed pack is the workflow in use', async () => {
  const { DEFAULT, order } = await import('../src/lib/workflow')
  expect(order(DEFAULT())).toEqual(['intake', 'design', 'epic', 'code', 'check', 'ship', 'shipped'])
})

it('a built Ticket in check merges into ship, staging confirms and it closes as shipped', async () => {
  const issue = await fake.tickets(repo).create({ title: 'ship me', labels: ['bauherr:stage:check'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'ship me', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'check', product, workspace: ws }, ...o })
  const branch = `bauherr/${issue.number}-x`
  await fake.forge.createBranch(repo, branch)
  const pr = await fake.forge.openPullRequest(repo, { title: 'ship me', head: branch, base: 'main' })
  const build = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'code', status: 'succeeded', mode: 'autonomous', workspace: ws, artifacts: { prUrl: pr.url } }, ...o })
  expect(build).toMatchObject({ stage: 'code', kind: 'build' })

  const sha = fake.merge(repo, pr.number)
  expect(await release.watchRelease(payload)).toMatchObject({ released: 1 })
  expect(await reload(t.id as number)).toMatchObject({ stage: 'ship', mergeSha: sha, releaseState: 'waiting' })
  expect((await fake.tickets(repo).get(String(issue.number))).labels).toContain('bauherr:stage:ship')
  expect(await wip.wipCount(payload, ws, 'ship')).toBe(1)
  expect(await wip.wipCount(payload, ws, 'check')).toBe(0)
  expect(needs.releaseWord(await reload(t.id as number))).toBe('waiting')

  fake.setChecks(repo, sha, [{ name: 'ci', status: 'completed', conclusion: 'success' }])
  await release.watchRelease(payload)
  await release.watchRelease(payload)
  expect(await reload(t.id as number)).toMatchObject({ stage: 'shipped', state: 'closed' })
  expect((await fake.tickets(repo).get(String(issue.number))).labels).toContain('bauherr:stage:shipped')
  expect((await runsOf(t.id as number)).map((r) => [r.stage, r.kind])).toEqual([['code', 'build']])
})
