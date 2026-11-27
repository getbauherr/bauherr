import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { CAPS } from '../core/caps'
import type { AdvanceDeps, MergeFn } from '../core/engine'
import { pacing } from '../core/intake/pacing'
import { createWriter, type ForgeWriter } from '../core/forge/writer'
import { namesOf, STAGING_DEPLOYMENT, STAGING_VERSION } from '../core/deploy'
import type { Config } from '../core/lifecycle'

const itemRow = z.object({ id: z.coerce.number() })

const productRow = z.object({
  staging_url: z.string().nullable(),
  deploy_checks: z.string().nullable(),
  deploy_wait_minutes: z.coerce.number().nullable(),
  risk_areas: z.array(z.string()).nullable(),
  required_checks: z.string().nullable(),
  auto_close: z.boolean().nullable(),
})

const deployNamesOf = (row: z.infer<typeof productRow> | null): string[] => [
  ...namesOf(row?.deploy_checks),
  ...((row?.staging_url ?? '').trim() === '' ? [] : [STAGING_DEPLOYMENT, STAGING_VERSION]),
]

export const lifecycleConfig = async (payload: Payload, recordId: number): Promise<Config> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT p."staging_url", p."deploy_checks", p."deploy_wait_minutes", p."risk_areas", p."required_checks",
      p."auto_close" FROM "records" r
    JOIN "products" p ON p."id" = r."product_id" WHERE r."id" = ${recordId}`)
  const row = found.rows[0] ? productRow.parse(found.rows[0]) : null
  const deployNames = deployNamesOf(row)
  const requiredCheckNames = namesOf(row?.required_checks)
  return {
    caps: { ...CAPS },
    riskAreas: row?.risk_areas ?? [],
    deployChecks: deployNames.length > 0,
    deployNames,
    deployWaitMinutes: row?.deploy_wait_minutes ?? 60,
    requiredChecks: requiredCheckNames.length > 0,
    requiredCheckNames,
    autoClose: row?.auto_close !== false,
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

export const engineDeps = (payload: Payload): AdvanceDeps => {
  const writer = createWriter(payload)
  return {
    payload,
    now: new Date(),
    configFor: (recordId) => lifecycleConfig(payload, recordId),
    merge: mergeVia(payload, writer),
    mayStart: pacing(payload),
    forge: writer,
  }
}
