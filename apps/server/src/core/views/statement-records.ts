import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { APPLIES, MEMORY_STAGES, REACH_LABEL, type Applies, type MemoryStage, type Reach } from '../memory'
import { STATEMENT_SCOPES, type StatementScope } from '../statement-scope'
import { STATEMENT_KINDS } from '../statements'
import type { ProductFilter } from './product-settings'

export const KIND_WORDS: Record<(typeof STATEMENT_KINDS)[number], string> = {
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
  record_id: z.number().nullable(),
  source_number: count.nullable(),
  scope: z.enum(STATEMENT_SCOPES),
  applies: z.enum(APPLIES),
  area: z.string().nullable(),
  stages: z.array(z.enum(MEMORY_STAGES)),
  off: z.boolean(),
  handed: count,
  came_back: count,
})

const fareRow = z.object({
  run_id: count,
  stage: z.string(),
  role: z.string(),
  record_id: count,
  source_number: count,
  title: z.string().nullable(),
  outcome: z.string().nullable(),
})

const handedIn = (workspace: number) => sql`
  WITH handed AS (
    SELECT r."id" AS run_id, r."stage", r."role", r."record_id", ids.value::int AS statement_id,
      (SELECT e."type" FROM "stage_runs" v
        JOIN "events" e ON e."record_id" = v."record_id" AND e."data" ->> 'runId' = v."id"::text
          AND e."type" IN ('verify.passed', 'verify.changes')
        WHERE v."record_id" = r."record_id" AND v."stage" = 'verify' AND v."id" > r."id"
        ORDER BY v."id" LIMIT 1) AS outcome
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
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    originalText: row.original_text,
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
  }
}

const SELECT = sql`
  SELECT s."id", s."kind", s."text", s."original_text", s."record_id", rec."source_number", s."scope", s."applies",
    s."area", s."stages", s."off", count(h.run_id) AS handed,
    count(h.run_id) FILTER (WHERE h.outcome = 'verify.changes') AS came_back
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

const OUTCOMES: Record<string, Fare['outcome']> = { 'verify.changes': 'came-back', 'verify.passed': 'clean' }

export const statementFare = async (payload: Payload, f: { workspace: number; id: number }): Promise<Fare[]> => {
  const found = await payload.db.drizzle.execute(sql`${handedIn(f.workspace)}
    SELECT h.run_id, h."stage", h."role", h.record_id, rec."source_number", i."title", h.outcome
    FROM handed h
    JOIN "records" rec ON rec."id" = h.record_id
    LEFT JOIN "mirror_items" i ON i."workspace_id" = rec."workspace_id" AND i."repo" = rec."source_repo"
      AND i."number" = rec."source_number" AND i."kind" = 'issue'
    WHERE h.statement_id = ${f.id} AND rec."workspace_id" = ${f.workspace}
    ORDER BY h.run_id DESC`)
  return found.rows.map((raw) => {
    const row = fareRow.parse(raw)
    const { run_id: run, stage, role } = row
    const ticket = { record: row.record_id, number: row.source_number, title: row.title }
    return { run, stage, role, ticket, outcome: OUTCOMES[row.outcome ?? ''] ?? 'open' }
  })
}

export type MemoryProduct = { id: number; name: string; riskAreas: string[] }

const productRow = z.object({ id: count, name: z.string(), risk_areas: z.array(z.string()).nullable() })

export const memoryProducts = async (payload: Payload, workspace: number): Promise<MemoryProduct[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "name", "risk_areas" FROM "products" WHERE "workspace_id" = ${workspace} ORDER BY "name", "id"`)
  return found.rows.map((raw) => {
    const row = productRow.parse(raw)
    return { id: row.id, name: row.name, riskAreas: row.risk_areas ?? [] }
  })
}
