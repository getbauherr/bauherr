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
const STAGES = ['plan', 'build', 'review', 'triage', 'scan', 'distill']
const WAITING = ['plan', 'build', 'review', 'checks']

beforeAll(async () => {
  testDb = await createTestDb('migrations_stage_text', undefined, { blank: true })
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

const enums = async () => (await run(sql`SELECT typname FROM pg_type WHERE typname IN ('enum_runs_stage', 'enum_tickets_waiting_for') ORDER BY typname`)).rows.map((r: any) => r.typname)

it('stage and waiting_for become text, runs get a kind, the active-run index survives, and down restores the enums', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === '20261110_140000_stage_text')
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  expect(await enums()).toEqual(['enum_runs_stage', 'enum_tickets_waiting_for'])

  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  await run(sql`INSERT INTO products (name, slug, workspace_id) SELECT 'P', 'p', id FROM workspaces`)
  for (const [n, wf] of WAITING.entries()) {
    await run(sql`INSERT INTO tickets (workspace_id, product_id, external_id, number, title, stage, waiting_for) SELECT workspace_id, id, ${'e' + n}, ${String(n)}, 't', 'plan', ${wf}::enum_tickets_waiting_for FROM products`)
  }
  for (const s of STAGES) {
    await run(sql`INSERT INTO runs (ticket_id, stage, status, mode, workspace_id) SELECT id, ${s}::enum_runs_stage, 'succeeded', 'autonomous', workspace_id FROM tickets WHERE external_id = 'e0'`)
  }

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  expect(await enums()).toEqual([])
  expect((await run(sql`SELECT stage, kind FROM runs ORDER BY id`)).rows).toEqual(STAGES.map((s) => ({ stage: s, kind: s })))
  expect((await run(sql`SELECT waiting_for FROM tickets ORDER BY id`)).rows.map((r: any) => r.waiting_for)).toEqual(WAITING)
  expect((await run(sql`SELECT data_type FROM information_schema.columns WHERE table_name = 'runs' AND column_name = 'stage'`)).rows[0].data_type).toBe('character varying')
  const idx = (await run(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'runs'`)).rows.map((r: any) => r.indexname)
  expect(idx).toEqual(expect.arrayContaining(['runs_active_per_ticket_stage', 'runs_stage_idx', 'runs_kind_idx']))

  const active = (stage: string) => run(sql`INSERT INTO runs (ticket_id, stage, status, mode, workspace_id) SELECT id, ${stage}, 'queued', 'autonomous', workspace_id FROM tickets WHERE external_id = 'e0'`)
  await active('qa')
  await expect(active('qa')).rejects.toMatchObject({ cause: { constraint: 'runs_active_per_ticket_stage' } })

  await run(sql`DELETE FROM runs WHERE stage = 'qa'`)
  await (await import('../src/migrations/20261110_140000_stage_text')).down({ db: (payload.db as any).drizzle } as never)
  expect(await enums()).toEqual(['enum_runs_stage', 'enum_tickets_waiting_for'])
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'runs' AND column_name = 'kind'`)).rows[0].n).toBe(0)
}, 180_000)
