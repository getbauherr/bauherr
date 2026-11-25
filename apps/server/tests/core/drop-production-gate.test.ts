import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as migration from '../../src/migrations/20261125_110000_drop_production_gate'
import { forPayload } from '../helpers/migration-db'
import { lifecycleConfig } from '../../src/jobs/engine-deps'
import { readRecord } from '../../src/core/record/store'
import { openCoreDb, type CoreDb } from './db'

let db: CoreDb
beforeAll(async () => {
  db = await openCoreDb('core_drop_production_gate')
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

const dropGate = () => forPayload({ name: 'drop_production_gate', ...migration })
const args = () => ({ db: db.payload.db.drizzle, payload: db.payload })
const run = (query: ReturnType<typeof sql>) => db.payload.db.drizzle.execute(query)

const waitingOn = async (reason: string): Promise<number> => {
  const id = await db.fresh()
  const card = JSON.stringify({ card: 'question', reason, options: ['approve', 'hold'], seq: 3 })
  await run(sql`UPDATE "records" SET "stage" = 'ship', "waiting_on" = 'owner', "card" = ${card}::jsonb
    WHERE "id" = ${id}`)
  return id
}

describe('dropping the production approval', () => {
  it('moves tickets waiting on the production question on as done and leaves other cards alone', async () => {
    const asked = await waitingOn('production')
    const held = await waitingOn('production-held')
    const other = await waitingOn('deploy-stalled')
    await dropGate().up(args())
    for (const id of [asked, held]) {
      expect(await readRecord(db.payload, id)).toMatchObject({ stage: 'done', waitingOn: 'nobody', card: null })
    }
    expect(await readRecord(db.payload, other)).toMatchObject({ stage: 'ship', waitingOn: 'owner' })
  })

  it('reads the lifecycle config of a Product without the column', async () => {
    const config = await lifecycleConfig(db.payload, await db.fresh())
    expect(config).not.toHaveProperty('productionGate')
  })

  it('restores the column as a plain boolean that defaults to false', async () => {
    await dropGate().down(args())
    const rows = await run(sql`SELECT "data_type", "column_default" FROM information_schema.columns
      WHERE "table_name" = 'products' AND "column_name" = 'production_gate'`)
    expect(z.array(z.record(z.string(), z.unknown())).parse(rows.rows)).toEqual([
      { data_type: 'boolean', column_default: 'false' },
    ])
    await run(sql`ALTER TABLE "products" DROP COLUMN "production_gate"`)
  })
})
