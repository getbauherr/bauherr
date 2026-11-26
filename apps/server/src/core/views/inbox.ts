import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { STAGES } from '../events'
import { toCard, type BoardCard } from './board'
import { loadRows, type RowFilter } from './rows'
import { ago, LIVE_RUN_SQL, LIVE_SQL, scope, STUCK_SQL, TERMINAL_LIST } from './sql'

export const INBOX_GROUPS = ['you', 'working', 'others', 'done'] as const
export type InboxGroupId = (typeof INBOX_GROUPS)[number]

export type InboxCursor = { updatedAt: string; id: number }
export type InboxChunk = { cards: BoardCard[]; total: number; cursor: InboxCursor | null }

const keyRow = z.object({
  id: z.coerce.number(),
  grp: z.enum(INBOX_GROUPS),
  n: z.coerce.number(),
  at: z.coerce.date(),
})

const GROUP = sql`CASE
  WHEN NOT ${LIVE_SQL} THEN 'done'
  WHEN r."parked" IS NOT NULL THEN 'others'
  WHEN ${STUCK_SQL} OR r."waiting_on" = 'owner' THEN 'you'
  WHEN r."waiting_on" = 'agents' AND s."id" IS NOT NULL THEN 'working'
  ELSE 'others' END`

const keys = (filter: RowFilter) => sql`SELECT r."id", ${GROUP} AS grp, date_trunc('milliseconds', r."updated_at") AS at
  FROM "records" r
  LEFT JOIN "stage_runs" s ON ${LIVE_RUN_SQL}
  LEFT JOIN LATERAL (
    SELECT e."created_at" AS at, e."data" ->> 'reason' AS reason FROM "events" e
    WHERE e."record_id" = r."id" AND e."type" IN (${TERMINAL_LIST}) ORDER BY e."id" DESC LIMIT 1
  ) t ON NOT ${LIVE_SQL}
  WHERE ${scope(filter.workspace, filter.product)} AND (${LIVE_SQL} OR (
    r."updated_at" >= ${ago(filter.now, 7)}::timestamptz AND t.reason IS DISTINCT FROM 'archived'
    AND t.at >= ${ago(filter.now, 7)}::timestamptz))`

const cardsOf = async (payload: Payload, filter: RowFilter, ids: number[]): Promise<Map<number, BoardCard>> => {
  if (ids.length === 0) return new Map()
  const rows = await loadRows(payload, { ...filter, ids })
  return new Map(rows.map((row) => [row.recordId, toCard(row)]))
}

const inRankOrder = (a: BoardCard, b: BoardCard): number =>
  a.rank - b.rank || a.enteredAt.localeCompare(b.enteredAt) || a.recordId - b.recordId

const byStage = (cards: BoardCard[]): BoardCard[] =>
  STAGES.flatMap((stage) => cards.filter((card) => card.stage === stage))

const chunkOf = (keys: z.infer<typeof keyRow>[], cards: Map<number, BoardCard>, total: number): InboxChunk => {
  const last = keys.at(-1)
  return {
    cards: keys.flatMap((key) => cards.get(key.id) ?? []),
    total,
    cursor: last ? { updatedAt: last.at.toISOString(), id: last.id } : null,
  }
}

export const loadInbox = async (
  payload: Payload,
  filter: RowFilter,
  pageSize: number,
): Promise<Record<InboxGroupId, InboxChunk>> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT w.* FROM (
      SELECT k.*, row_number() OVER (PARTITION BY grp ORDER BY at DESC, id DESC) AS rn,
        count(*) OVER (PARTITION BY grp) AS n
      FROM (${keys(filter)}) k) w
    WHERE w.grp = 'you' OR w.rn <= ${pageSize}
    ORDER BY w.grp, w.rn`)
  const found = result.rows.map((row) => keyRow.parse(row))
  const cards = await cardsOf(payload, filter, found.map((row) => row.id))
  const chunks = {} as Record<InboxGroupId, InboxChunk>
  for (const group of INBOX_GROUPS) {
    const mine = found.filter((row) => row.grp === group)
    chunks[group] = chunkOf(mine, cards, mine[0]?.n ?? 0)
  }
  chunks.you.cards = byStage(chunks.you.cards.sort(inRankOrder))
  return chunks
}

export const inboxMore = async (
  payload: Payload,
  filter: RowFilter,
  input: { group: InboxGroupId; after: InboxCursor; limit: number },
): Promise<InboxChunk> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT k.*, 0 AS n FROM (${keys(filter)}) k
    WHERE k.grp = ${input.group} AND (k.at, k.id) < (${input.after.updatedAt}::timestamptz, ${input.after.id})
    ORDER BY k.at DESC, k.id DESC LIMIT ${input.limit}`)
  const found = result.rows.map((row) => keyRow.parse(row))
  return chunkOf(found, await cardsOf(payload, filter, found.map((row) => row.id)), 0)
}
