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

const NAME = '20261111_120000_agent_sessions'

beforeAll(async () => {
  testDb = await createTestDb('migrations_agent_sessions', undefined, { blank: true })
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

it('the migration adds agent_sessions, session_spans and runs.session that Payload reads and writes', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('agent_sessions', 'session_spans')`)).rows[0].n).toBe(0)
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  // The Bauherren table of the current schema carries the Product owner assignments: this test creates an account.
  await payload.db.migrate({ migrations: migrations.filter((m) => m.name === '20261112_110000_product_owner') as never })
  const o = { overrideAccess: true } as const
  const ws = (await payload.find({ collection: 'workspaces', limit: 1, ...o })).docs[0].id
  const owner = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  const session = await payload.create({ collection: 'agent_sessions', data: { publicId: 'ses_a', workspace: ws, owner: owner.id, role: 'engineer', clientKey: 'k', connectedAt: new Date().toISOString(), endReason: 'timeout' } as never, ...o })
  await payload.create({ collection: 'session_spans', data: { session: session.id, workspace: ws, startedAt: new Date().toISOString(), lastAt: new Date().toISOString() } as never, ...o })
  expect(await payload.findByID({ collection: 'agent_sessions', id: session.id, ...o })).toMatchObject({ publicId: 'ses_a', endReason: 'timeout' })
  await expect(run(sql`INSERT INTO agent_sessions (workspace_id, public_id, owner_id, role, client_key) VALUES (${ws}, 'ses_b', ${owner.id}, 'engineer', 'k')`)).rejects.toThrow()
  await run(sql`INSERT INTO agent_sessions (workspace_id, public_id, owner_id, role) VALUES (${ws}, 'ses_c', ${owner.id}, 'engineer'), (${ws}, 'ses_d', ${owner.id}, 'engineer')`)
  await run(sql`UPDATE runs SET session_id = ${session.id} WHERE false`)
  expect((await run(sql`SELECT indexname FROM pg_indexes WHERE indexname IN ('agent_sessions_public_id_idx', 'workspace_disconnected_at_idx', 'last_seen_at_idx', 'workspace_owner_client_key_idx', 'session_started_at_idx', 'runs_session_idx') ORDER BY 1`)).rows).toHaveLength(6)

  await (await import('../src/migrations/20261111_120000_agent_sessions')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('agent_sessions', 'session_spans')`)).rows[0].n).toBe(0)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'runs' AND column_name = 'session_id'`)).rows[0].n).toBe(0)
}, 180_000)
