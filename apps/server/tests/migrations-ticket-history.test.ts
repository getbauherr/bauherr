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

const NAME = '20261110_160000_ticket_history'
const hm = "to_char(e.at AT TIME ZONE 'UTC', 'HH24:MI')"

beforeAll(async () => {
  testDb = await createTestDb('migrations_ticket_history', undefined, { blank: true })
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

const d = (time: string) => `2026-11-01T${time}:00Z`

it('the migration backfills each Ticket from its creation, Runs and approvals, and sets its history key', async () => {
  const { migrations } = await import('../src/migrations')
  const i = migrations.findIndex((m) => m.name === NAME)
  expect(i).toBeGreaterThan(0)
  await payload.db.migrate({ migrations: migrations.slice(0, i) as never })
  await run(sql`INSERT INTO workspaces (name, slug) VALUES ('W', 'w')`)
  await run(sql`INSERT INTO products (name, slug, workspace_id) SELECT 'P', 'p', id FROM workspaces`)
  const ticket = (n: string, state: string, stage: string, created: string, updated: string, published: string | null) =>
    run(sql`INSERT INTO tickets (workspace_id, product_id, external_id, number, title, state, stage, created_at, updated_at, release_published_at) SELECT workspace_id, id, ${n}, ${n}, ${'t' + n}, ${state}::enum_tickets_state, ${stage}, ${created}, ${updated}, ${published} FROM products`)
  const runRow = (n: string, stage: string, mode: string, created: string, started: string | null, finished: string | null) =>
    run(sql`INSERT INTO runs (workspace_id, ticket_id, stage, kind, status, mode, session_label, created_at, started_at, finished_at) SELECT workspace_id, id, ${stage}, ${stage}, 'succeeded', ${mode}::enum_runs_mode, 'sess', ${created}, ${started}, ${finished} FROM tickets WHERE external_id = ${n}`)
  const touch = (n: string, kind: string, at: string) => run(sql`INSERT INTO human_touches (workspace_id, ticket_id, kind, actor, at) SELECT workspace_id, id, ${kind}, 'alice@x.io', ${at} FROM tickets WHERE external_id = ${n}`)

  await ticket('1', 'open', 'build', d('10:00'), d('11:00'), null)
  await runRow('1', 'plan', 'session', d('10:01'), d('10:02'), d('10:10'))
  await touch('1', 'approve:plan', d('10:30'))
  await runRow('1', 'build', 'autonomous', d('10:31'), d('10:32'), d('11:00'))
  await runRow('1', 'scan', 'autonomous', d('10:40'), d('10:41'), d('10:42'))
  await ticket('2', 'closed', 'done', d('09:00'), d('12:00'), d('11:30'))
  await runRow('2', 'plan', 'autonomous', d('09:01'), d('09:01'), d('09:05'))

  await payload.db.migrate({ migrations: migrations.slice(i, i + 1) as never })
  const rows = async (n: string) => (await run(sql`SELECT ${sql.raw(hm)} AS at, e.stage, e.phase, e.executor, e.cause, e.from_stage, e.backfilled, e.actor FROM ticket_events e JOIN tickets t ON t.id = e.ticket_id WHERE t.external_id = ${n} ORDER BY e.at, e.id`)).rows
  const seq = (r: any[]) => r.map((x) => [x.at, x.stage, x.phase])
  const one: any[] = await rows('1')
  expect(seq(one)).toEqual([
    ['10:00', 'triage', 'queued'],
    ['10:01', 'plan', 'queued'],
    ['10:02', 'plan', 'working'],
    ['10:10', 'plan', 'queued'],
    ['10:10', 'plan', 'human'],
    ['10:30', 'plan', 'queued'],
    ['10:31', 'build', 'queued'],
    ['10:32', 'build', 'working'],
    ['11:00', 'build', 'queued'],
  ])
  expect(one.every((r: any) => r.backfilled)).toBe(true)
  expect(one[2]).toMatchObject({ executor: 'session', cause: 'backfill:run:started', actor: 'sess' })
  expect(one[5]).toMatchObject({ executor: 'human', cause: 'gate:approve:plan', actor: 'alice@x.io' })
  expect(one[6]).toMatchObject({ executor: 'runner', from_stage: 'plan' })
  expect(seq(await rows('2'))).toEqual([['09:00', 'triage', 'queued'], ['09:01', 'plan', 'queued'], ['09:01', 'plan', 'working'], ['09:05', 'plan', 'queued'], ['11:30', 'done', 'closed']])
  expect((await run(sql`SELECT external_id, history_key FROM tickets ORDER BY external_id`)).rows).toEqual([{ external_id: '1', history_key: 'build|queued' }, { external_id: '2', history_key: 'done|closed' }])

  await (await import('../src/migrations/20261110_160000_ticket_history')).down({ db: (payload.db as any).drizzle } as never)
  expect((await run(sql`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'ticket_events'`)).rows[0].n).toBe(0)
}, 180_000)
