import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CAPS } from '../../src/core/caps'
import { lifecycleConfig } from '../../src/jobs/engine-deps'
import { openCoreDb, type CoreDb } from './db'

let db: CoreDb
beforeAll(async () => {
  db = await openCoreDb('core_config')
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

const setProduct = (fields: ReturnType<typeof sql>) =>
  db.payload.db.drizzle.execute(sql`UPDATE "products" SET ${fields} WHERE "id" = ${db.product}`)

describe('lifecycleConfig', () => {
  it('uses the caps constant and the defaults of a plain Product', async () => {
    const record = await db.fresh()
    expect(await lifecycleConfig(db.payload, record)).toEqual({
      caps: { verifyRounds: 3, reporterRounds: 2, failedRuns: 2 },
      riskAreas: [],
      productionGate: false,
      deployChecks: false,
      deployNames: [],
      deployWaitMinutes: 60,
      requiredChecks: false,
      autoClose: true,
    })
    expect(CAPS.verifyRounds).toBe(3)
  })

  it('reads the gate, risk areas and deploy checks from the Product', async () => {
    const record = await db.fresh()
    const fields = sql`"production_gate" = true, "risk_areas" = '["security","billing"]'::jsonb,
      "deploy_checks" = 'ci, deploy'`
    await setProduct(fields)
    expect(await lifecycleConfig(db.payload, record)).toMatchObject({
      riskAreas: ['security', 'billing'],
      productionGate: true,
      deployChecks: true,
      deployNames: ['ci', 'deploy'],
    })
  })

  it('reads the required checks from the Product', async () => {
    const record = await db.fresh()
    await setProduct(sql`"required_checks" = 'ci, lint'`)
    expect((await lifecycleConfig(db.payload, record)).requiredChecks).toBe(true)
    await setProduct(sql`"required_checks" = ' , '`)
    expect((await lifecycleConfig(db.payload, record)).requiredChecks).toBe(false)
  })

  it('reads the deploy wait limit from the Product', async () => {
    const record = await db.fresh()
    await setProduct(sql`"deploy_wait_minutes" = 15`)
    expect((await lifecycleConfig(db.payload, record)).deployWaitMinutes).toBe(15)
  })

  it('treats blank deploy checks as none', async () => {
    const record = await db.fresh()
    await setProduct(sql`"deploy_checks" = ' , '`)
    expect((await lifecycleConfig(db.payload, record)).deployChecks).toBe(false)
  })
})
