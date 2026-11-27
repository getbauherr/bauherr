import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Conn } from '../conn'
import { fold } from '../fold'
import { readEvents } from '../record/store'

export type Part = {
  itemId: number
  number: number
  title: string
  open: boolean
  stage: string | null
  recordId: number | null
  finished: boolean
}

const count = z.coerce.number()
const partRow = z.object({
  id: count,
  number: count,
  title: z.string(),
  open: z.boolean(),
  record: count.nullable(),
  stage: z.string().nullable(),
})
const idRow = z.object({ id: count })

const isFinished = async (payload: Conn, row: z.infer<typeof partRow>): Promise<boolean> => {
  if (row.record === null) return !row.open
  const state = fold(await readEvents(payload, row.record))
  return state.stage === 'done' || state.closed !== null
}

export const partsOf = async (payload: Conn, recordId: number): Promise<Part[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT c."id", c."number", c."title", (c."state" = 'open') AS "open", rec."id" AS "record", rec."stage"
    FROM "records" mine
    JOIN "mirror_items" me ON me."workspace_id" = mine."workspace_id" AND me."repo" = mine."source_repo"
      AND me."number" = mine."source_number" AND me."kind" = 'issue'
    JOIN "ticket_relations" r ON r."to_item_id" = me."id" AND r."type" = 'part-of'
    JOIN "mirror_items" c ON c."id" = r."from_item_id" AND c."gone_at" IS NULL
    LEFT JOIN "records" rec ON rec."workspace_id" = c."workspace_id" AND rec."source_repo" = c."repo"
      AND rec."source_number" = c."number"
    WHERE mine."id" = ${recordId}
    ORDER BY c."number"`)
  const parts: Part[] = []
  for (const row of result.rows.map((raw) => partRow.parse(raw))) {
    parts.push({
      itemId: row.id,
      number: row.number,
      title: row.title,
      open: row.open,
      stage: row.stage,
      recordId: row.record,
      finished: await isFinished(payload, row),
    })
  }
  return parts
}

export const unfinishedParts = async (payload: Conn, recordId: number): Promise<number[]> =>
  (await partsOf(payload, recordId)).filter((part) => !part.finished).map((part) => part.number)

export const waitingEpicsOf = async (payload: Conn, recordId: number): Promise<number[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT parent."id" FROM "records" mine
    JOIN "mirror_items" me ON me."workspace_id" = mine."workspace_id" AND me."repo" = mine."source_repo"
      AND me."number" = mine."source_number" AND me."kind" = 'issue'
    JOIN "ticket_relations" r ON r."from_item_id" = me."id" AND r."type" = 'part-of'
    JOIN "mirror_items" p ON p."id" = r."to_item_id"
    JOIN "records" parent ON parent."workspace_id" = p."workspace_id" AND parent."source_repo" = p."repo"
      AND parent."source_number" = p."number"
    WHERE mine."id" = ${recordId} AND parent."stage" = 'ship' AND parent."waiting_on" = 'nobody'`)
  return result.rows.map((row) => idRow.parse(row).id)
}
