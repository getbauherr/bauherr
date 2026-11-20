import type { Payload } from 'payload'
import { z } from 'zod'
import { LIVE_RUN_INDEX } from '../../src/migrations/20261119_140000_stage_runs'
import { createRecord } from '../../src/core/record/store'
import { createTestDb, type TestDb } from '../helpers/test-db'
import { source } from './fixtures'

const o = { overrideAccess: true } as const
const idOf = (doc: { id: number | string }) => z.coerce.number().parse(doc.id)

export type CoreDb = {
  payload: Payload
  workspace: number
  otherWorkspace: number
  product: number
  fresh: (workspace?: number) => Promise<number>
  drop: () => Promise<void>
}

export type CoreIds = { workspace: number; otherWorkspace: number; product: number }

export const coreDbOn = (payload: Payload, ids: CoreIds, drop: () => Promise<void>): CoreDb => {
  let n = 0
  const fresh = async (inWorkspace = ids.workspace): Promise<number> => {
    n++
    const numbered = { ...source, number: 1000 + n }
    const input = { workspace: inWorkspace, product: ids.product, source: numbered, type: 'bug' as const }
    return (await createRecord(payload, input)).id
  }
  return { payload, ...ids, fresh, drop }
}

export const openCoreDb = async (suite: string): Promise<CoreDb> => {
  const testDb: TestDb = await createTestDb(suite)
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  const payload = await getPayload({ config: (await import('../../src/payload.config')).default })
  await payload.db.drizzle.execute(LIVE_RUN_INDEX)
  const make = (slug: string) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })
  const workspace = idOf(await make('alpha'))
  const otherWorkspace = idOf(await make('beta'))
  const data = { name: 'p', slug: 'p', workspace }
  const product = idOf(await payload.create({ collection: 'products', data, ...o }))
  const drop = async () => {
    await payload.destroy()
    await testDb.drop(payload)
  }
  return coreDbOn(payload, { workspace, otherWorkspace, product }, drop)
}
