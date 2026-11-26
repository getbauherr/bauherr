import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { fold } from '../lifecycle'
import { readEvents, type StoredRecord } from '../record/store'

const count = z.coerce.number()
const baseRow = z.object({
  number: count,
  state: z.enum(['open', 'closed', 'merged']),
  record_number: count.nullable(),
  record_id: count.nullable(),
})
const idRow = z.object({ id: count })

export type StackBase = { number: number; open: boolean }

export const stackBaseOf = async (payload: Payload, stored: StoredRecord, pr: number): Promise<StackBase | null> => {
  const { repo } = stored.record.source
  const found = await payload.db.drizzle.execute(sql`
    SELECT b."number", b."state", rec."source_number" AS record_number, rec."id" AS record_id FROM "mirror_items" c
    JOIN "mirror_items" b ON b."workspace_id" = c."workspace_id" AND b."repo" = c."repo" AND b."kind" = 'pr'
      AND b."head_ref" = c."base_ref" AND b."number" <> c."number"
    LEFT JOIN "records" rec ON rec."workspace_id" = b."workspace_id" AND rec."source_repo" = b."repo"
      AND rec."pr" = b."number"
    WHERE c."workspace_id" = ${stored.workspace} AND c."repo" = ${repo} AND c."number" = ${pr} AND c."kind" = 'pr'
    ORDER BY b."number" DESC LIMIT 1`)
  const row = found.rows[0] ? baseRow.parse(found.rows[0]) : null
  if (row === null) return null
  const discarded = row.record_id !== null && fold(await readEvents(payload, row.record_id)).closed !== null
  return { number: row.record_number ?? row.number, open: row.state === 'open' && !discarded }
}

export const stackedOnRecord = async (payload: Payload, stored: StoredRecord): Promise<number[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT rec."id" FROM "records" me
    JOIN "mirror_items" b ON b."workspace_id" = me."workspace_id" AND b."repo" = me."source_repo"
      AND b."number" = me."pr" AND b."kind" = 'pr'
    JOIN "mirror_items" c ON c."workspace_id" = b."workspace_id" AND c."repo" = b."repo" AND c."kind" = 'pr'
      AND c."base_ref" = b."head_ref" AND c."number" <> b."number"
    JOIN "records" rec ON rec."workspace_id" = c."workspace_id" AND rec."source_repo" = c."repo"
      AND rec."pr" = c."number" AND rec."stage" = 'ship'
    WHERE me."id" = ${stored.id}`)
  return found.rows.map((row) => idRow.parse(row).id)
}
