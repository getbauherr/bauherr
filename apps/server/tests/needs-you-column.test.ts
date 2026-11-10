import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
const o = { overrideAccess: true } as const
const repo = 'acme/web'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('needs_you_column')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'fake' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const seed = async (title: string, data: Record<string, unknown>, run?: Record<string, unknown>) => {
  const issue = await fake.tickets(repo).create({ title, labels: [] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', product, workspace: ws, ...data }, ...o })
  if (run) await payload.create({ collection: 'runs', data: { ticket: t.id, mode: 'autonomous', workspace: ws, ...run }, ...o })
  return t.id as number
}

it('the sweep writes the needsYou column the overview computes, and the top bar query counts the open ones', async () => {
  await seed('plan', { stage: 'plan' }, { stage: 'plan', status: 'succeeded' })
  await seed('questions', { stage: 'triage', labels: ['bauherr:needs-refinement'] })
  await seed('stuck build', { stage: 'build' }, { stage: 'build', status: 'needs_human', reasonKind: 'access' })
  await seed('staging', { stage: 'release', releaseState: 'on_staging' })
  await seed('healthy', { stage: 'build' }, { stage: 'build', status: 'running' })
  await seed('closed', { stage: 'done', state: 'closed' })

  const { syncGates } = await import('../src/lib/gates')
  await syncGates(payload)

  const { loadOverviewRows } = await import('../src/app/(app)/lib/overview')
  const { tickets } = await loadOverviewRows(ws, true)
  const stored = (await payload.find({ collection: 'tickets', where: { workspace: { equals: ws } }, pagination: false, depth: 0, ...o })).docs as Record<string, any>[]
  expect(tickets).toHaveLength(6)
  for (const row of tickets.filter((t) => t.open)) expect(stored.find((t) => t.id === row.id)!.needsYou ?? null, row.title).toBe(row.needsYou)
  expect(tickets.filter((t) => t.open && t.needsYou).length).toBe(4)

  const counted = await payload.count({ collection: 'tickets', where: { workspace: { equals: ws }, state: { equals: 'open' }, needsYou: { exists: true } }, ...o })
  expect(counted.totalDocs).toBe(tickets.filter((t) => t.open && t.needsYou).length)
})
