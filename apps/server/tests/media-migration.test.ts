import { postgresAdapter } from '@payloadcms/db-postgres'
import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_media_migration WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_media_migration')
  await admin.end()
  const url = base.replace(/\/[^/]+$/, '/bauherr_test_media_migration')
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
})

it('stores and reads media with its workspace on the migrated schema (push off)', async () => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace }, ...o })).id
  const session = (await payload.create({ collection: 'intake_sessions', data: { product, workspace }, ...o })).id
  const m = await payload.create({ collection: 'media', data: { session, workspace, name: 's.png', mime: 'image/png', data: 'AA==' }, ...o })
  const found = await payload.find({ collection: 'media', where: { workspace: { equals: workspace } }, depth: 0, ...o })
  expect(found.docs.map((d) => d.id)).toEqual([m.id])
  expect((await payload.findByID({ collection: 'media', id: m.id, depth: 1, ...o }) as any).session.workspace).toBeTruthy()
})
