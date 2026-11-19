import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('../src/app/(app)/lib/session', () => ({
  currentWorkspace: async () => signedIn,
  payloadClient: async () => payload,
  workspacesOf: async () => [],
}))

const o = { overrideAccess: true } as const
const num = (value: unknown) => z.coerce.number().parse(value)
let payload: Payload
let signedIn: unknown
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb('product_state')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const setup = async (slug: string, role: 'admin' | 'bauherr' = 'admin') => {
  const created = await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })
  const workspace = num(created.id)
  const data = { email: `${slug}@x.io`, password: 'pw-123456', role, tenants: [{ tenant: workspace }] }
  const user = await payload.create({ collection: 'bauherren', data, ...o })
  const made = await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })
  const product = num(made.id)
  signedIn = { user, workspaces: [], workspace: created }
  return { workspace, product }
}

const stateOf = async (product: number) =>
  z.string().parse((await payload.findByID({ collection: 'products', id: product, ...o })).state)

it('lets an Admin switch a Product between observing and active', async () => {
  const { setProductState } = await import('../src/app/(app)/(shell)/settings/state-action')
  const { product } = await setup('ps-admin')
  const send = (state: string) => setProductState({}, form({ id: String(product), state }))
  expect(await stateOf(product)).toBe('observing')
  expect((await send('active')).saved).toBe(true)
  expect(await stateOf(product)).toBe('active')
  expect((await send('paused')).error).toBeTruthy()
  expect((await send('observing')).saved).toBe(true)
  expect(await stateOf(product)).toBe('observing')
})

it('does not let a member who is not an Admin switch the state', async () => {
  const { setProductState } = await import('../src/app/(app)/(shell)/settings/state-action')
  const { product } = await setup('ps-member', 'bauherr')
  const result = await setProductState({}, form({ id: String(product), state: 'active' }))
  expect(result.error).toBeTruthy()
  expect(await stateOf(product)).toBe('observing')
})

it('refuses to delete a Product that has tickets', async () => {
  const actions = await import('../src/app/(app)/(shell)/settings/actions')
  const { workspace, product } = await setup('ps-tickets')
  await payload.db.drizzle.execute(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
      "waiting_on", "rank", "version", "data", "updated_at", "created_at")
    VALUES (${workspace}, ${product}, 'github', 'a/b', 1, 'intake', 'agents', 0, 1, '{}'::jsonb, now(), now())`)
  const result = await actions.removeDoc({}, form({ collection: 'products', id: String(product) }))
  expect(result.error).toBe('This Product has 1 ticket and cannot be deleted.')
  const left = await payload.count({ collection: 'products', where: { id: { equals: product } }, ...o })
  expect(left.totalDocs).toBe(1)
})
