import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/** `syncGates` judges a Ticket in a stage with Jobs by the worst Run of the visit, not by the newest (fixtures/jobs-pack, stage audit). */
let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
const o = { overrideAccess: true } as const
const repo = 'acme/gates'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/jobs-pack', import.meta.url))
  testDb = await createTestDb('gates_job_runs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const ticketWith = async (runs: [string, string, Record<string, unknown>?][]) => {
  const issue = await fake.tickets(repo).create({ title: 't', labels: ['bauherr:stage:audit'] })
  const id = (await payload.create({ collection: 'tickets', data: { title: 't', externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'audit', product, workspace: ws }, ...o })).id as number
  for (const [job, status, extra] of runs) await payload.create({ collection: 'runs', data: { ticket: id, stage: 'audit', kind: 'agent', job, status, mode: 'autonomous', workspace: ws, ...extra }, ...o })
  return id
}
const needsYou = async (id: number) => ((await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>).needsYou ?? null

it('a Job Run that needs the owner counts although a newer Job Run is still running', async () => {
  const id = await ticketWith([['security', 'needs_human', { reasonKind: 'decision' }], ['ux', 'running']])
  const { syncGates } = await import('../src/lib/gates')
  await syncGates(payload)
  expect(await needsYou(id)).toBe('Run needs you')
})

it('a stopped Job Run that a newer Run of the same Job replaced no longer counts', async () => {
  const id = await ticketWith([['security', 'needs_human', { reasonKind: 'decision' }], ['security', 'running'], ['ux', 'running']])
  const { syncGates } = await import('../src/lib/gates')
  await syncGates(payload)
  expect(await needsYou(id)).toBeNull()
})
