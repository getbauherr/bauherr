import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_166_agent_keys_migration WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_166_agent_keys_migration')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_166_agent_keys_migration')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
})

it('D2: the migration disables existing personal keys and creates the agent key schema', async () => {
  const { sql } = await import('@payloadcms/db-postgres')
  const db = payload.db.drizzle
  // Schema push created the new tables; roll back to the pre-migration shape, with a personal key in use.
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "agent_keys_id"; ALTER TABLE "tool_calls" DROP COLUMN "agent_key_id"; ALTER TABLE "runs" DROP COLUMN "agent_key_id"; DROP TABLE "agent_keys" CASCADE;`)
  const user = await payload.create({ collection: 'bauherren', data: { email: 'old@x.io', password: 'pw-123456', role: 'bauherr', enableAPIKey: true, apiKey: 'old-personal-key' }, overrideAccess: true } as never)
  const before = (await payload.auth({ headers: new Headers({ authorization: 'bauherren API-Key old-personal-key' }) })).user
  expect(before?.email).toBe('old@x.io')

  await (await import('../src/migrations/20261102_150166_agent_keys')).up({ db } as never)

  expect((await db.execute(sql`SELECT "enable_a_p_i_key" AS e FROM "bauherren" WHERE id = ${user.id}`)).rows[0]).toMatchObject({ e: false })
  expect((await payload.auth({ headers: new Headers({ authorization: 'bauherren API-Key old-personal-key' }) })).user).toBeNull()
  await db.execute(sql`SELECT agent_key_id FROM "runs" LIMIT 1; SELECT agent_key_id FROM "tool_calls" LIMIT 1; SELECT id FROM "agent_keys" LIMIT 1;`)
})
