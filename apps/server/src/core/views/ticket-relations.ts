import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { partsOf } from '../relations/parts'
import { stageWord } from './relations'

export const RELATION_GROUPS = ['part-of', 'blocked-by', 'blocks', 'relates-to'] as const
export type RelationGroup = (typeof RELATION_GROUPS)[number]

export type RelatedTicket = {
  itemId: number
  number: number
  title: string
  stage: string
  open: boolean
  recordId: number | null
}
export type Candidate = { itemId: number; number: number; title: string }
export type PartTicket = RelatedTicket & { finished: boolean }
export type TicketRelations = {
  itemId: number
  groups: Record<RelationGroup, RelatedTicket[]>
  parts: { done: number; total: number; tickets: PartTicket[] }
}

const SEARCH_LIMIT = 20

const count = z.coerce.number()
const own = z.object({ id: count })
const related = z.object({
  group: z.enum(RELATION_GROUPS),
  id: count,
  number: count,
  title: z.string(),
  state: z.string(),
  gone: z.boolean(),
  record: count.nullable(),
  stage: z.string().nullable(),
})
const candidate = z.object({ id: count, number: count, title: z.string() })


export const itemOfRecord = async (
  payload: Payload,
  workspace: number,
  recordId: number,
): Promise<number | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT m."id" FROM "records" r
    JOIN "mirror_items" m ON m."workspace_id" = r."workspace_id" AND m."repo" = r."source_repo"
      AND m."number" = r."source_number" AND m."kind" = 'issue'
    WHERE r."id" = ${recordId} AND r."workspace_id" = ${workspace}`)
  return result.rows[0] ? own.parse(result.rows[0]).id : null
}

export const recordOfItem = async (payload: Payload, item: number): Promise<number | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."id" FROM "mirror_items" m
    JOIN "records" r ON r."workspace_id" = m."workspace_id" AND r."source_repo" = m."repo"
      AND r."source_number" = m."number"
    WHERE m."id" = ${item}`)
  return result.rows[0] ? own.parse(result.rows[0]).id : null
}

export const loadTicketRelations = async (
  payload: Payload,
  workspace: number,
  recordId: number,
): Promise<TicketRelations | null> => {
  const itemId = await itemOfRecord(payload, workspace, recordId)
  if (itemId === null) return null
  const rows = await payload.db.drizzle.execute(sql`
    SELECT e."group", o."id", o."number", o."title", o."state", o."gone_at" IS NOT NULL AS gone,
      orec."id" AS record, orec."stage"
    FROM (
      SELECT 'blocked-by' AS "group", "from_item_id" AS other, "id" FROM "ticket_relations"
        WHERE "to_item_id" = ${itemId} AND "type" = 'blocks'
      UNION ALL
      SELECT 'part-of', "to_item_id", "id" FROM "ticket_relations"
        WHERE "from_item_id" = ${itemId} AND "type" = 'part-of'
      UNION ALL
      SELECT 'relates-to', CASE WHEN "from_item_id" = ${itemId} THEN "to_item_id" ELSE "from_item_id" END, "id"
        FROM "ticket_relations"
        WHERE ("from_item_id" = ${itemId} OR "to_item_id" = ${itemId}) AND "type" = 'relates-to'
      UNION ALL
      SELECT 'blocks', "to_item_id", "id" FROM "ticket_relations"
        WHERE "from_item_id" = ${itemId} AND "type" = 'blocks'
    ) e
    JOIN "mirror_items" o ON o."id" = e.other
    LEFT JOIN "records" orec ON orec."workspace_id" = o."workspace_id" AND orec."source_repo" = o."repo"
      AND orec."source_number" = o."number"
    ORDER BY o."number"`)
  const groups: TicketRelations['groups'] = { 'part-of': [], 'blocked-by': [], blocks: [], 'relates-to': [] }
  for (const raw of rows.rows) {
    const row = related.parse(raw)
    const open = row.state === 'open' && !row.gone
    groups[row.group].push({
      itemId: row.id,
      number: row.number,
      title: row.title,
      stage: stageWord({ open, stage: row.stage }),
      open,
      recordId: row.record,
    })
  }
  const tickets = (await partsOf(payload, recordId)).map((part) => ({
    itemId: part.itemId,
    number: part.number,
    title: part.title,
    stage: stageWord(part),
    open: part.open,
    recordId: part.recordId,
    finished: part.finished,
  }))
  const done = tickets.filter((ticket) => ticket.finished).length
  return { itemId, groups, parts: { done, total: tickets.length, tickets } }
}

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`)

export const searchTickets = async (
  payload: Payload,
  workspace: number,
  recordId: number,
  query: string,
): Promise<Candidate[]> => {
  const itemId = await itemOfRecord(payload, workspace, recordId)
  if (itemId === null) return []
  const text = query.trim().replace(/^#/, '')
  const pattern = `%${escapeLike(text)}%`
  const prefix = `${escapeLike(text)}%`
  const pool = await payload.db.drizzle.execute(sql`
    SELECT o."id", o."number", o."title" FROM "mirror_items" m
    JOIN "mirror_items" o ON o."product_id" = m."product_id" AND o."workspace_id" = m."workspace_id"
    WHERE m."id" = ${itemId} AND o."id" <> m."id" AND o."kind" = 'issue' AND o."gone_at" IS NULL
      AND (${text} = '' OR o."number"::text LIKE ${prefix} OR o."title" ILIKE ${pattern})
    ORDER BY (o."number"::text = ${text}) DESC, (o."number"::text LIKE ${prefix}) DESC, o."number" DESC
    LIMIT ${SEARCH_LIMIT}`)
  return pool.rows.map((raw) => {
    const row = candidate.parse(raw)
    return { itemId: row.id, number: row.number, title: row.title }
  })
}
