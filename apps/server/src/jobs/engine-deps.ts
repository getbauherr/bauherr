import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { CAPS } from '../core/caps'
import type { AdvanceDeps, MergeFn } from '../core/engine'
import { createWriter, type ForgeWriter } from '../core/forge/writer'
import type { Config } from '../core/lifecycle'

const itemRow = z.object({ id: z.coerce.number() })

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

export const mergeVia =
  (payload: Payload, writer: Pick<ForgeWriter, 'mergePullRequest'>): MergeFn =>
  async (target) => {
    const { repo } = target.source
    const found = await payload.db.drizzle.execute(sql`
      SELECT i."id" FROM "mirror_items" i JOIN "records" r ON r."id" = ${target.recordId}
      WHERE i."workspace_id" = r."workspace_id" AND i."repo" = ${repo} AND i."number" = ${target.pr}
        AND i."kind" = 'pr'`)
    const row = found.rows[0] ? itemRow.parse(found.rows[0]) : null
    if (!row) throw new Error(`Pull request ${repo}#${target.pr} is not in the mirror yet: wait for the next sync.`)
    const mergeSha = await writer.mergePullRequest({ recordId: target.recordId, itemId: row.id }, target.headSha)
    return { sha: mergeSha }
  }

export const engineDeps = (payload: Payload): AdvanceDeps => ({
  payload,
  now: new Date(),
  configFor: (recordId) => lifecycleConfig(payload, recordId),
  merge: mergeVia(payload, createWriter(payload)),
})
