import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stepSchema } from './run-steps'

export type LiveVersion = { version: string; notes: string | null; at: string }

const liveRow = z.object({ version: z.string(), steps: z.array(stepSchema) })

export const liveVersionOf = async (
  payload: Payload,
  at: { workspace: number; recordId: number },
): Promise<LiveVersion | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "version", "steps" FROM "product_releases"
    WHERE "workspace_id" = ${at.workspace}
      AND "tickets" @> ${JSON.stringify([{ recordId: at.recordId }])}::jsonb
      AND "steps" @> '[{"id": "publish", "status": "done"}]'::jsonb
    ORDER BY "id" DESC LIMIT 1`)
  if (!found.rows[0]) return null
  const row = liveRow.parse(found.rows[0])
  const published = row.steps.find((step) => step.id === 'publish')
  return { version: row.version, notes: published?.link ?? null, at: published?.at ?? new Date(0).toISOString() }
}
