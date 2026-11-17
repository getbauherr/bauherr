import { fileURLToPath } from 'node:url'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let ws: number
let product: number
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/release-jobs-pack', import.meta.url))
  testDb = await createTestDb('release_jobs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('a Ticket in release starts no Job Run until the staging walk engine exists', async () => {
  const t = await payload.create({ collection: 'tickets', data: { title: 'released', externalId: '1', number: 1, url: 'u', state: 'open', stage: 'release', releaseState: 'on_staging', product, workspace: ws }, ...o })
  const { startReadyJobs } = await import('../src/lib/stage-jobs')
  expect(await startReadyJobs(payload, { id: t.id })).toBe(false)
  expect((await payload.count({ collection: 'runs', where: { ticket: { equals: t.id } }, ...o })).totalDocs).toBe(0)
})
