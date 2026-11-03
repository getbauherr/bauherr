import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('166_agent_keys_migration')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
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
