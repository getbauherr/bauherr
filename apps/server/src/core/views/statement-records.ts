import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { acceptedCheck, checkOf, mayMakeCheck, type CheckState, type Prevention } from '../memory-check'
import { APPLIES, MEMORY_STAGES, REACH_LABEL, type Applies, type MemoryStage, type Reach } from '../memory'
import { STATEMENT_SCOPES, type StatementScope } from '../statement-scope'
import { STATEMENT_KINDS, type StatementKind } from '../statements'
import type { ProductFilter } from './product-settings'

export const SOURCE_KINDS = ['finding', 'send-back', 'brief-change'] as const

const LEARNED_WORDS: Record<(typeof SOURCE_KINDS)[number], string> = {
  finding: 'Reviewer finding',
  'send-back': 'Your send-back',
  'brief-change': 'Your Brief change',
}

export const KIND_WORDS: Record<Exclude<StatementKind, 'learned'>, string> = {
  answer: 'Your answer',
  'send-back': 'Your send-back',
  'brief-change': 'Your Brief change',
  guidance: 'Your guidance',
  written: 'You wrote it',
}

export type StatementRecord = {
  id: number
  kind: (typeof STATEMENT_KINDS)[number]
  text: string
  originalText: string | null
  from: string
  isNew: boolean
  sourceText: string | null
  learnRun: number | null
  ticket: { record: number; number: number } | null
  scope: StatementScope
  applies: Applies
  area: string | null
  reach: Reach
  reachLabel: string
  stages: MemoryStage[]
  off: boolean
  handed: number
  cameBack: number
  check: CheckState
  mayCheck: boolean
}

export type Fare = {
  run: number
  stage: string
  role: string
  ticket: { record: number; number: number; title: string | null }
  outcome: 'came-back' | 'clean' | 'open'
}

const count = z.coerce.number()

const recordRow = z.object({
  id: count,
  kind: z.enum(STATEMENT_KINDS),
  text: z.string(),
  original_text: z.string().nullable(),
  source_kind: z.enum(SOURCE_KINDS).nullable(),
  source_text: z.string().nullable(),
  learn_run: count.nullable(),
  is_new: z.boolean(),
  record_id: z.number().nullable(),
  source_number: count.nullable(),
  scope: z.enum(STATEMENT_SCOPES),
  applies: z.enum(APPLIES),
  area: z.string().nullable(),
  stages: z.array(z.enum(MEMORY_STAGES)),
  off: z.boolean(),
  handed: count,
  came_back: count,
  check_issue: count.nullable(),
  check_record: count.nullable(),
  check_accepted: z.boolean(),
  check_ended_at: z.coerce.date().nullable(),
})

const fareRow = z.object({
  run_id: count,
  stage: z.string(),
  role: z.string(),
  record_id: count,
  source_number: count,
  title: z.string().nullable(),
  outcome: z.enum(['came-back', 'clean', 'open']),
})

const handedIn = (workspace: number) => sql`
  WITH handed AS (
    SELECT r."id" AS run_id, r."stage", r."role", r."record_id", ids.value::int AS statement_id
    FROM "stage_runs" r
    CROSS JOIN LATERAL jsonb_array_elements_text(r."context" -> 'statements') AS ids
    WHERE r."workspace_id" = ${workspace})`

export const reachOf = (row: { scope: StatementScope; applies: Applies }): Reach =>
  row.scope === 'ticket' ? 'ticket' : row.applies

const recordOf = (raw: unknown): StatementRecord => {
  const row = recordRow.parse(raw)
  const reach = reachOf(row)
  const { record_id: record, source_number: number } = row
  const ticket = record === null || number === null ? null : { record, number }
  const prevention: Prevention = {
    scope: row.scope,
    off: row.off,
    cameBack: row.came_back,
    issue: row.check_issue,
    record: row.check_record,
    accepted: row.check_accepted,
    endedAt: row.check_ended_at?.toISOString() ?? null,
  }
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    originalText: row.original_text,
    from: row.kind === 'learned' ? LEARNED_WORDS[row.source_kind ?? 'finding'] : KIND_WORDS[row.kind],
    isNew: row.is_new,
    sourceText: row.source_text,
    learnRun: row.learn_run,
    ticket,
    scope: row.scope,
    applies: row.applies,
    area: row.area,
    reach,
    reachLabel: reach === 'area' ? `Area: ${row.area ?? ''}` : REACH_LABEL[reach],
    stages: row.stages,
    off: row.off,
    handed: row.handed,
    cameBack: row.came_back,
    check: checkOf(prevention),
    mayCheck: mayMakeCheck(prevention),
  }
}

const preventionRecord = sql`(SELECT c."id" FROM "records" c
  WHERE c."workspace_id" = s."workspace_id" AND c."source_number" = s."check_issue"
    AND c."data"->'source'->>'memory' = s."id"::text LIMIT 1)`

const checkEndedAt = sql`(SELECT CASE WHEN e."type" = 'ticket.restored' THEN NULL ELSE e."created_at" END
  FROM "events" e WHERE e."record_id" = ${preventionRecord}
    AND e."type" IN ('ticket.closed', 'brief.discarded', 'ticket.restored')
  ORDER BY e."id" DESC LIMIT 1)`

const SELECT = sql`
  SELECT s."id", s."kind", s."text", s."original_text", s."source_kind", s."source_text", s."learn_run",
    (s."kind" = 'learned' AND s."seen_at" IS NULL) AS is_new, s."record_id", rec."source_number", s."scope",
    s."applies", s."area", s."stages", s."off", count(h.run_id) AS handed,
    jsonb_array_length(s."came_back") AS came_back, s."check_issue", ${preventionRecord} AS check_record,
    ${acceptedCheck} AS check_accepted, ${checkEndedAt} AS check_ended_at
  FROM "statements" s
  LEFT JOIN "records" rec ON rec."id" = s."record_id"
  LEFT JOIN handed h ON h.statement_id = s."id"`

export const statementRecords = async (payload: Payload, f: ProductFilter): Promise<StatementRecord[]> => {
  const found = await payload.db.drizzle.execute(sql`${handedIn(f.workspace)} ${SELECT}
    WHERE s."product_id" = ${f.product} AND s."workspace_id" = ${f.workspace}
    GROUP BY s."id", rec."source_number" ORDER BY s."off", s."id" DESC`)
  return found.rows.map(recordOf)
}

export const statementRecord = async (
  payload: Payload,
  f: { workspace: number; id: number },
): Promise<(StatementRecord & { product: number }) | null> => {
  const found = await payload.db.drizzle.execute(sql`${handedIn(f.workspace)} ${SELECT}
    WHERE s."id" = ${f.id} AND s."workspace_id" = ${f.workspace}
    GROUP BY s."id", rec."source_number"`)
  const raw = found.rows[0]
  if (!raw) return null
  const owner = await payload.db.drizzle.execute(sql`SELECT "product_id" FROM "statements" WHERE "id" = ${f.id}`)
  return { ...recordOf(raw), product: count.parse(owner.rows[0]?.product_id) }
}

export const statementFare = async (payload: Payload, f: { workspace: number; id: number }): Promise<Fare[]> => {
  const found = await payload.db.drizzle.execute(sql`${handedIn(f.workspace)}
    SELECT h.run_id, h."stage", h."role", h.record_id, rec."source_number", i."title",
      CASE
        WHEN s."came_back" @> jsonb_build_array(jsonb_build_object('record', h.record_id)) THEN 'came-back'
        WHEN EXISTS (SELECT 1 FROM "events" e WHERE e."record_id" = h.record_id AND e."type" = 'result.accepted')
          AND NOT EXISTS (SELECT 1 FROM "stage_runs" l WHERE l."record_id" = h.record_id AND l."stage" = 'done'
            AND l."status" IN ('queued', 'claimed')) THEN 'clean'
        ELSE 'open'
      END AS outcome
    FROM handed h
    JOIN "statements" s ON s."id" = h.statement_id
    JOIN "records" rec ON rec."id" = h.record_id
    LEFT JOIN "mirror_items" i ON i."workspace_id" = rec."workspace_id" AND i."repo" = rec."source_repo"
      AND i."number" = rec."source_number" AND i."kind" = 'issue'
    WHERE h.statement_id = ${f.id} AND rec."workspace_id" = ${f.workspace}
    ORDER BY h.run_id DESC`)
  return found.rows.map((raw) => {
    const row = fareRow.parse(raw)
    const { run_id: run, stage, role } = row
    const ticket = { record: row.record_id, number: row.source_number, title: row.title }
    return { run, stage, role, ticket, outcome: row.outcome }
  })
}

export type MemoryProduct = { id: number; name: string; riskAreas: string[]; repo: string | null }

const productRow = z.object({
  id: count,
  name: z.string(),
  risk_areas: z.array(z.string()).nullable(),
  repo: z.string().nullable(),
})

export const memoryProducts = async (payload: Payload, workspace: number): Promise<MemoryProduct[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT p."id", p."name", p."risk_areas",
      (SELECT s."repo" FROM "ticket_sources" s WHERE s."product_id" = p."id" ORDER BY s."id" LIMIT 1) AS repo
    FROM "products" p WHERE p."workspace_id" = ${workspace} ORDER BY p."name", p."id"`)
  return found.rows.map((raw) => {
    const row = productRow.parse(raw)
    return { id: row.id, name: row.name, riskAreas: row.risk_areas ?? [], repo: row.repo }
  })
}

export const newMemoryCount = async (payload: Payload, workspace: number): Promise<number> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT count(*) AS n FROM "statements"
    WHERE "workspace_id" = ${workspace} AND "kind" = 'learned' AND "seen_at" IS NULL`)
  return count.parse(found.rows[0]?.n)
}

const keptRow = z.object({ id: count, text: z.string() })

export const keptMemories = async (payload: Payload, recordId: number): Promise<{ id: number; text: string }[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "text" FROM "statements" WHERE "record_id" = ${recordId} AND "kind" = 'learned' ORDER BY "id"`)
  return found.rows.map((raw) => keptRow.parse(raw))
}
