import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
})

it('a bauherr of workspace A cannot read workspace B tickets', async () => {
  const o = { overrideAccess: true } as const
  const seed = async (slug: string) => {
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id
    const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id
    const ticket = await payload.create({
      collection: 'tickets',
      data: { title: `ticket ${slug}`, externalId: slug, product, workspace },
      ...o,
    })
    return { workspace, ticket }
  }
  // The first Bauherr ever created becomes the Admin.
  await payload.create({ collection: 'bauherren', data: { email: 'admin@example.com', password: 'pw-admin-12345' }, ...o } as never)
  const a = await seed('a')
  const b = await seed('b')
  const doc = await payload.create({
    collection: 'bauherren',
    data: { email: 'a@example.com', password: 'pw-a-12345', role: 'bauherr', tenants: [{ tenant: a.workspace }] },
    ...o,
  } as never)
  const user = { ...doc, collection: 'bauherren' } as never

  const list = await payload.find({ collection: 'tickets', user, overrideAccess: false })
  expect(list.docs.map((t) => t.id)).toEqual([a.ticket.id])
  await expect(payload.findByID({ collection: 'tickets', id: b.ticket.id, user, overrideAccess: false })).rejects.toThrow()
  expect((await payload.findByID({ collection: 'tickets', id: a.ticket.id, user, overrideAccess: false })).title).toBe('ticket a')
})
