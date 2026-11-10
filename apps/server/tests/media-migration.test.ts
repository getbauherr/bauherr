import { postgresAdapter } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('media_migration', undefined, { blank: true })
  const url = testDb.url
  process.env.DATABASE_URL = url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  const { migrations } = await import('../src/migrations')
  const config = await (await import('../src/payload.config')).default
  payload = await getPayload({ config: { ...config, db: postgresAdapter({ pool: { connectionString: url }, push: false }) as never } })
  await payload.db.migrate({ migrations: migrations as never })
}, 120_000)

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('stores new files and still reads a legacy base64 row on the migrated schema (push off)', async () => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace }, ...o })).id
  const session = (await payload.create({ collection: 'intake_sessions', data: { product, workspace }, ...o })).id
  const { sql } = await import('@payloadcms/db-postgres')
  await (payload.db as any).drizzle.execute(sql`insert into media (workspace_id, session_id, name, mime, data) values (${workspace}, ${session}, 'old.png', 'image/png', 'AA==')`)
  const { saveMedia, mediaBytes } = await import('../src/lib/intake/media')
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))
  const fresh = await saveMedia(payload, { bytes: png, name: 'new.png', workspace, product, ticketNumber: 7 })
  const found = await payload.find({ collection: 'media', where: { workspace: { equals: workspace } }, sort: 'id', depth: 0, ...o })
  expect(found.docs.map((d) => d.name)).toEqual(['old.png', 'new.png'])
  expect(Buffer.from(await mediaBytes(payload, found.docs[0] as any)).toString('base64')).toBe('AA==')
  expect([...(await mediaBytes(payload, found.docs[1] as any))]).toEqual([...png])
  expect(fresh).toMatchObject({ mime: 'image/png', mimeType: 'image/png', ticketNumber: 7 })
  expect((await payload.findByID({ collection: 'media', id: found.docs[0]!.id, depth: 1, ...o }) as any).session.workspace).toBeTruthy()
})
