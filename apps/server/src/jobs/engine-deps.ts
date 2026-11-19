import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { AdvanceDeps } from '../core/engine'
import type { Config } from '../core/lifecycle'

const gateRow = z.object({ production_gate: z.boolean().nullable() })

export const engineDeps = (payload: Payload): AdvanceDeps => ({
  payload,
  now: new Date(),
  configFor: async (recordId): Promise<Config> => {
    const found = await payload.db.drizzle.execute(sql`
      SELECT p."production_gate" FROM "records" r JOIN "products" p ON p."id" = r."product_id"
      WHERE r."id" = ${recordId}`)
    const row = found.rows[0]
    return {
      caps: { verifyRounds: 2, reporterRounds: 2, failedRuns: 2 },
      riskAreas: [],
      productionGate: row ? gateRow.parse(row).production_gate === true : false,
      deployChecks: false,
    }
  },
  merge: () => Promise.reject(new Error('The forge writer is not connected to the engine: wire merge here.')),
})
