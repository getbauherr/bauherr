import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { fold, type Blocker } from '../lifecycle'
import { readEvents, type StoredRecord } from '../record/store'
import { RELATION_TYPES } from './types'

const BLOCKING_KEYS = RELATION_TYPES.filter((type) => type.blocksWork).map((type) => sql`${type.key}`)

const count = z.coerce.number()
const blockerRow = z.object({ number: count, open: z.boolean(), record_id: count.nullable() })
const recordIdRow = z.object({ id: count })

const stateOf = async (payload: Payload, recordId: number): Promise<Blocker['state'] | null> => {
  const state = fold(await readEvents(payload, recordId))
  if (state.merged || state.stage === 'done') return null
  if (state.closed === null) return 'open'
  return state.closed === 'discarded' ? 'discarded' : 'closed'
}

export const blockersOf = async (payload: Payload, stored: StoredRecord): Promise<Blocker[]> => {
  const { repo, number } = stored.record.source
  const result = await payload.db.drizzle.execute(sql`
    SELECT b."number", (b."state" = 'open' AND b."gone_at" IS NULL) AS "open", rec."id" AS "record_id"
    FROM "mirror_items" me
    JOIN "ticket_relations" r ON r."to_item_id" = me."id" AND r."type" IN (${sql.join(BLOCKING_KEYS, sql`, `)})
    JOIN "mirror_items" b ON b."id" = r."from_item_id"
    LEFT JOIN "records" rec ON rec."workspace_id" = b."workspace_id" AND rec."source_repo" = b."repo"
      AND rec."source_number" = b."number"
    WHERE me."workspace_id" = ${stored.workspace} AND me."repo" = ${repo} AND me."number" = ${number}
      AND me."kind" = 'issue'
    ORDER BY b."number"`)
  const blockers: Blocker[] = []
  for (const row of result.rows.map((r) => blockerRow.parse(r))) {
    const state = row.record_id === null ? (row.open ? 'open' : null) : await stateOf(payload, row.record_id)
    if (state !== null) blockers.push({ number: row.number, state })
  }
  return blockers
}

export const blockedByRecord = async (payload: Payload, stored: StoredRecord): Promise<number[]> => {
  const { repo, number } = stored.record.source
  const result = await payload.db.drizzle.execute(sql`
    SELECT rec."id" FROM "mirror_items" me
    JOIN "ticket_relations" r ON r."from_item_id" = me."id" AND r."type" IN (${sql.join(BLOCKING_KEYS, sql`, `)})
    JOIN "mirror_items" b ON b."id" = r."to_item_id"
    JOIN "records" rec ON rec."workspace_id" = b."workspace_id" AND rec."source_repo" = b."repo"
      AND rec."source_number" = b."number"
    WHERE me."workspace_id" = ${stored.workspace} AND me."repo" = ${repo} AND me."number" = ${number}
      AND me."kind" = 'issue' AND rec."stage" = 'build' AND rec."waiting_on" = 'nobody'`)
  return result.rows.map((row) => recordIdRow.parse(row).id)
}
