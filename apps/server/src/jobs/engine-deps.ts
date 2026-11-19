import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { CAPS } from '../core/caps'
import type { AdvanceDeps } from '../core/engine'
import type { Config } from '../core/lifecycle'

const productRow = z.object({
  production_gate: z.boolean().nullable(),
  deploy_checks: z.string().nullable(),
  risk_areas: z.array(z.string()).nullable(),
})

export const lifecycleConfig = async (payload: Payload, recordId: number): Promise<Config> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT p."production_gate", p."deploy_checks", p."risk_areas" FROM "records" r
    JOIN "products" p ON p."id" = r."product_id" WHERE r."id" = ${recordId}`)
  const row = found.rows[0] ? productRow.parse(found.rows[0]) : null
  return {
    caps: { ...CAPS },
    riskAreas: row?.risk_areas ?? [],
    productionGate: row?.production_gate === true,
    deployChecks: (row?.deploy_checks ?? '').split(',').some((name) => name.trim() !== ''),
  }
}

export const engineDeps = (payload: Payload): AdvanceDeps => ({
  payload,
  now: new Date(),
  configFor: (recordId) => lifecycleConfig(payload, recordId),
  merge: () => Promise.reject(new Error('The forge writer is not connected to the engine: wire merge here.')),
})
