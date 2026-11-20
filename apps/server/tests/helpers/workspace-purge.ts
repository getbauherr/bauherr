import type { Payload } from 'payload'
import { createTestDb, type TestDb } from './test-db'

export type PurgeDb = {
  payload: Payload
  testDb: TestDb
  del: typeof import('../../src/lib/workspace-delete')
}

export const bootPurgeDb = async (suite: string): Promise<PurgeDb> => {
  const testDb = await createTestDb(suite)
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  const del = await import('../../src/lib/workspace-delete')
  return { payload, testDb, del }
}
