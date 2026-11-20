import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { personOf } from './helpers/person'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('isolation')
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

it('a bauherr of workspace A cannot read workspace B products', async () => {
  const o = { overrideAccess: true } as const
  const seed = async (slug: string) => {
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id
    const product = await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })
    return { workspace, product }
  }
  await payload.create({
    collection: 'bauherren',
    data: { email: 'admin@example.com', password: 'pw-admin-12345' },
    ...o,
  })
  const a = await seed('a')
  const b = await seed('b')
  const doc = await payload.create({
    collection: 'bauherren',
    data: { email: 'a@example.com', password: 'pw-a-12345', role: 'bauherr', tenants: [{ tenant: a.workspace }] },
    ...o,
  })
  const user = personOf(doc)

  const list = await payload.find({ collection: 'products', user, overrideAccess: false })
  expect(list.docs.map((p) => p.id)).toEqual([a.product.id])
  await expect(
    payload.findByID({ collection: 'products', id: b.product.id, user, overrideAccess: false }),
  ).rejects.toThrow()
  expect((await payload.findByID({ collection: 'products', id: a.product.id, user, overrideAccess: false })).name).toBe(
    'a',
  )
})
