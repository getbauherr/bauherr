import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stageSchema, type Stage } from '../events'
import { cardSchema, WAITING_ON, type StoredCard, type WaitingOn } from '../record/store'
import { ago, ENTRY_TABLE, LIVE_RUN_SQL, LIVE_SQL, scope, TERMINAL_LIST } from './sql'

export type RowFilter = { workspace: number; product?: number; now: Date }

const count = z.coerce.number()

const rowSchema = z.object({
  id: count,
  product_id: count,
  product_name: z.string(),
  source_repo: z.string(),
  source_number: count,
  stage: stageSchema,
  waiting_on: z.enum(WAITING_ON),
  rank: count,
  card: cardSchema.nullable(),
  parked: z.string().nullable(),
  title: z.string().nullable(),
  entered_at: z.coerce.date(),
  verify_rounds: count,
  reporter_round: count.nullable(),
  question_drafted: z.boolean(),
  terminal_type: z.string().nullable(),
  terminal_at: z.coerce.date().nullable(),
  role: z.enum(['builder', 'reviewer', 'verifier']).nullable(),
  leased_by: z.string().nullable(),
  step: z.string().nullable(),
  terminal_reason: z.string().nullable(),
  criteria_total: count,
  criteria_met: count,
})

export type ClosedAs = 'not-a-bug' | 'duplicate' | 'not-planned' | 'discarded' | 'closed-on-forge'

export type TicketRow = {
  recordId: number
  product: { id: number; name: string }
  repo: string
  number: number
  stage: Stage
  waitingOn: WaitingOn
  rank: number
  card: StoredCard | null
  parked: string | null
  title: string
  enteredAt: Date
  verifyRounds: number
  reporterRound: number | null
  questionDrafted: boolean
  ended: 'accepted' | 'closed' | null
  closedAs: ClosedAs | null
  criteria: { met: number; total: number }
  endedAt: Date | null
  run: { role: 'builder' | 'reviewer' | 'verifier'; leasedBy: string | null; step: string | null } | null
}

const ACCEPTED = ['result.accepted', 'production.approved']

const CLOSED_AS: ClosedAs[] = ['not-a-bug', 'duplicate', 'not-planned', 'discarded', 'closed-on-forge']

export const closedAsOf = (type: string | null, reason: string | null): ClosedAs | null => {
  if (type === 'brief.discarded') return 'discarded'
  return CLOSED_AS.find((known) => known === reason) ?? null
}

export const endedOf = (type: string | null): 'accepted' | 'closed' | null =>
  type === null ? null : ACCEPTED.includes(type) ? 'accepted' : 'closed'

const toRow = (raw: unknown): TicketRow => {
  const r = rowSchema.parse(raw)
  const ended = endedOf(r.terminal_type)
  return {
    recordId: r.id,
    product: { id: r.product_id, name: r.product_name },
    repo: r.source_repo,
    number: r.source_number,
    stage: r.waiting_on === 'nobody' && r.parked === null ? 'done' : r.stage,
    waitingOn: r.waiting_on,
    rank: r.rank,
    card: r.card,
    parked: r.parked,
    title: r.title ?? `#${r.source_number}`,
    enteredAt: r.entered_at,
    verifyRounds: r.verify_rounds,
    reporterRound: r.reporter_round,
    questionDrafted: r.question_drafted,
    ended: r.waiting_on === 'nobody' && r.parked === null ? (ended ?? 'closed') : null,
    endedAt: r.terminal_at,
    closedAs: ended === 'closed' ? closedAsOf(r.terminal_type, r.terminal_reason) : null,
    criteria: { met: r.criteria_met, total: r.criteria_total },
    run: r.role === null ? null : { role: r.role, leasedBy: r.leased_by, step: r.step },
  }
}

export const loadRows = async (payload: Payload, filter: RowFilter): Promise<TicketRow[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."id", r."product_id", p."name" AS product_name, r."source_repo", r."source_number", r."stage",
      r."waiting_on", r."rank", r."card", r."parked", i."title", ev."entered_at", ev."verify_rounds",
      ev."reporter_round", ev."question_drafted", ev."terminal_type", ev."terminal_at", s."role", s."leased_by",
      s."steps" -> -1 ->> 'text' AS step, ev."terminal_reason",
      jsonb_array_length(coalesce(r."data" -> 'criteria', '[]'::jsonb)) AS criteria_total,
      (SELECT count(*) FROM jsonb_array_elements(coalesce(r."data" -> 'criteria', '[]'::jsonb)) c
        WHERE c ->> 'status' = 'met') AS criteria_met
    FROM "records" r
    JOIN "products" p ON p."id" = r."product_id"
    LEFT JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = r."source_number"
    LEFT JOIN "stage_runs" s ON ${LIVE_RUN_SQL}
    LEFT JOIN LATERAL (
      SELECT coalesce(max(e."created_at") FILTER (
          WHERE m."stage" = CASE WHEN ${LIVE_SQL} THEN r."stage" ELSE 'done' END), r."created_at") AS entered_at,
        count(*) FILTER (WHERE e."type" = 'verify.changes') AS verify_rounds,
        max((e."data"->>'round')::integer) FILTER (WHERE e."type" = 'intake.asked') AS reporter_round,
        NOT coalesce(max(e."id") FILTER (WHERE e."type" = 'forge.write.done' AND e."data"->>'kind' = 'question')
          > max(e."id") FILTER (WHERE e."type" = 'intake.asked'), false) AS question_drafted,
        (array_agg(e."type" ORDER BY e."id" DESC) FILTER (WHERE e."type" IN (${TERMINAL_LIST})))[1] AS terminal_type,
        (array_agg(e."data" ->> 'reason' ORDER BY e."id" DESC) FILTER (WHERE e."type" IN (${TERMINAL_LIST})))[1]
          AS terminal_reason,
        max(e."created_at") FILTER (WHERE e."type" IN (${TERMINAL_LIST})) AS terminal_at
      FROM "events" e LEFT JOIN ${ENTRY_TABLE} ON m."type" = e."type" WHERE e."record_id" = r."id"
    ) ev ON true
    WHERE ${scope(filter.workspace, filter.product)}
      AND (${LIVE_SQL} OR r."updated_at" >= ${ago(filter.now, 7)}::timestamptz)
    ORDER BY r."rank", ev."entered_at", r."id"`)
  return result.rows.map(toRow)
}
