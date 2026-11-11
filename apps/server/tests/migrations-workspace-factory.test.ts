import { postgresAdapter, sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const run = (q: ReturnType<typeof sql>) => (payload.db as any).drizzle.execute(q)

const NAME = '20261110_170000_workspace_factory'

beforeAll(async () => {
  testDb = await createTestDb('migrations_workspace_factory', undefined, { blank: true })
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.GATEWAY_ADMIN_URL = 'http://127.0.0.1:1'
  process.env.GATEWAY_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'bauherr-gw-'))
  const { getPayload } = await import('payload')
  const config = await (await import('../src/payload.config')).default
  payload = await getPayload({ config: { ...config, db: postgresAdapter({ pool: { connectionString: testDb.url }, push: false }) as never } })
}, 120_000)

afterAll(async () => {
  delete process.env.GATEWAY_ADMIN_URL
  delete process.env.GATEWAY_CONFIG_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('the migration lets a workflow version belong to a Workspace only and adds the active-version pointer', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  await run(sql`INSERT INTO products (name, slug, workspace_id) SELECT 'P', 'p', id FROM workspaces`)
  await run(sql`INSERT INTO workflow_versions (workspace_id, product_id, version, compiled) SELECT workspace_id, id, 1, '{}'::jsonb FROM products`)
  await expect(run(sql`INSERT INTO workflow_versions (workspace_id, version) SELECT id, 2 FROM workspaces`)).rejects.toThrow()

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  await run(sql`INSERT INTO workflow_versions (workspace_id, version, source, compiled, hash, applied_by, applied_via, note) SELECT id, 2, 'v: 1', '{}'::jsonb, 'abc', 'a@x.io', 'cli', 'n' FROM workspaces`)
  await run(sql`UPDATE workspaces SET workflow_version_id = (SELECT id FROM workflow_versions WHERE version = 2)`)
  expect((await run(sql`SELECT v.version, v.hash, v.applied_via FROM workspaces w JOIN workflow_versions v ON v.id = w.workflow_version_id`)).rows).toEqual([{ version: '2', hash: 'abc', applied_via: 'cli' }])
  expect((await run(sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('workflow_versions_hash_idx', 'workspaces_workflow_version_idx') ORDER BY 1`)).rows).toHaveLength(2)

  await (await import('../src/migrations/20261110_170000_workspace_factory')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'workspaces' AND column_name = 'workflow_version_id'`)).rows[0].n).toBe(0)
}, 180_000)
