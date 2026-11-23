import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { Stage } from '../events'
import type { AgentsFile } from '../mirror/facts'
import { anyWord, queryWords, sharedWords, sharesEnough } from '../mirror/match'
import { similarItems } from '../mirror/search'
import type { StoredRecord } from '../record/store'
import { SCOPE_LABEL, STATEMENT_SCOPES } from '../statement-scope'
import { STATEMENT_KINDS } from '../statements'
import { closedAsOf, endedOf } from '../views/rows'
import { TERMINAL_LIST } from '../views/sql'
import { contextSchema, type StoredContext } from './schema'

export const STATEMENT_LIMIT = 5
export const SIMILAR_TICKETS = 3
const STATEMENT_STAGES: Stage[] = ['brief', 'build', 'verify']

export type UsedStatement = {
  id: number
  kind: (typeof STATEMENT_KINDS)[number]
  scope: (typeof STATEMENT_SCOPES)[number]
  scopeLabel: string
  text: string
  ticket: number
  at: string
  record: number
}

export type PackSimilar = {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  url: string
  record: { goal: string; outcome: 'accepted' | 'closed' | 'open'; reason: string | null } | null
}

export type ContextParts = {
  agentsFile: AgentsFile | null
  statements: UsedStatement[]
  similar: PackSimilar[]
}

const count = z.coerce.number()
const idRow = z.object({ id: count })

const statementRow = z.object({
  id: count,
  kind: z.enum(STATEMENT_KINDS),
  scope: z.enum(STATEMENT_SCOPES),
  text: z.string(),
  created_at: z.coerce.date(),
  record_id: count,
  source_number: count,
})

const similarRow = z.object({
  id: count,
  number: count,
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  url: z.string().nullable(),
  goal: z.string().nullable(),
  record_id: count.nullable(),
  waiting_on: z.string().nullable(),
  parked: z.string().nullable(),
  terminal_type: z.string().nullable(),
  terminal_reason: z.string().nullable(),
})

const sourceRow = z.object({ agents_file: z.string().nullable(), agents_file_cut: z.boolean().nullable() })
const issueRow = z.object({ id: count.nullable(), title: z.string().nullable(), product_id: count })

const ids = (values: number[]) => sql.join(values.map((value) => sql`${value}`), sql`, `)
const inOrder = <T extends { id: number }>(wanted: number[], found: T[]): T[] =>
  wanted.flatMap((id) => found.filter((row) => row.id === id))

export const loadStatements = async (payload: Payload, wanted: number[]): Promise<UsedStatement[]> => {
  if (wanted.length === 0) return []
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."id", s."kind", s."scope", s."text", s."created_at", s."record_id", r."source_number"
    FROM "statements" s JOIN "records" r ON r."id" = s."record_id"
    WHERE s."id" IN (${ids(wanted)})`)
  const rows = found.rows.map((raw) => {
    const row = statementRow.parse(raw)
    return {
      id: row.id,
      kind: row.kind,
      scope: row.scope,
      scopeLabel: SCOPE_LABEL[row.scope],
      text: row.text,
      ticket: row.source_number,
      at: row.created_at.toISOString(),
      record: row.record_id,
    }
  })
  return inOrder(wanted, rows)
}

const loadSimilar = async (payload: Payload, wanted: number[]): Promise<PackSimilar[]> => {
  if (wanted.length === 0) return []
  const found = await payload.db.drizzle.execute(sql`
    SELECT i."id", i."number", i."title", i."state", i."url", r."id" AS record_id, r."data" ->> 'goal' AS goal,
      r."waiting_on", r."parked",
      (SELECT e."type" FROM "events" e WHERE e."record_id" = r."id" AND e."type" IN (${TERMINAL_LIST})
        ORDER BY e."id" DESC LIMIT 1) AS terminal_type,
      (SELECT e."data" ->> 'reason' FROM "events" e WHERE e."record_id" = r."id" AND e."type" IN (${TERMINAL_LIST})
        ORDER BY e."id" DESC LIMIT 1) AS terminal_reason
    FROM "mirror_items" i
    LEFT JOIN "records" r ON r."workspace_id" = i."workspace_id" AND r."source_repo" = i."repo"
      AND r."source_number" = i."number"
    WHERE i."id" IN (${ids(wanted)})`)
  const rows = found.rows.map((raw) => {
    const row = similarRow.parse(raw)
    const live = row.waiting_on !== 'nobody' || row.parked !== null
    const ended = live ? null : endedOf(row.terminal_type)
    const outcome: 'accepted' | 'closed' | 'open' = ended ?? 'open'
    const reason = ended === 'closed' ? closedAsOf(row.terminal_type, row.terminal_reason) : null
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      state: row.state,
      url: row.url ?? '',
      record: row.record_id === null ? null : { goal: row.goal ?? '', outcome, reason },
    }
  })
  return inOrder(wanted, rows).map((row) => ({
    number: row.number,
    title: row.title,
    state: row.state,
    url: row.url,
    record: row.record,
  }))
}

const loadAgentsFile = async (payload: Payload, workspace: number, repo: string): Promise<AgentsFile | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "agents_file", "agents_file_cut" FROM "ticket_sources"
    WHERE "workspace_id" = ${workspace} AND "repo" = ${repo}`)
  const row = found.rows[0] ? sourceRow.parse(found.rows[0]) : null
  return row?.agents_file == null ? null : { text: row.agents_file, cut: row.agents_file_cut ?? false }
}

export const selectContext = async (
  payload: Payload,
  stage: Stage,
  stored: StoredRecord,
): Promise<StoredContext> => {
  const agents = await loadAgentsFile(payload, stored.workspace, stored.record.source.repo)
  const none = { statements: [], similar: [], agentsFile: { given: agents !== null, cut: agents?.cut ?? false } }
  const found = await payload.db.drizzle.execute(sql`
    SELECT i."id", i."title", r."product_id" FROM "records" r
    LEFT JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = r."source_number" AND i."kind" = 'issue'
    WHERE r."id" = ${stored.id}`)
  const issue = issueRow.parse(found.rows[0])
  const words = queryWords(`${issue.title ?? ''} ${stored.record.goal}`)
  const vector = sql`to_tsvector('simple', s."text")`
  const shared = sharedWords(vector, words)
  const statements =
    STATEMENT_STAGES.includes(stage) && words.length > 0
      ? await payload.db.drizzle.execute(sql`
          SELECT s."id" FROM "statements" s
          WHERE s."product_id" = ${issue.product_id} AND (s."record_id" = ${stored.id} OR s."scope" = 'product')
            AND ${vector} @@ ${anyWord(words)} AND ${sharesEnough(vector, words)}
          ORDER BY ${shared} DESC, ts_rank(${vector}, ${anyWord(words)}) DESC, s."created_at" DESC, s."id" DESC
          LIMIT ${STATEMENT_LIMIT}`)
      : { rows: [] }
  const similar =
    stage === 'brief' && issue.id !== null ? await similarItems(payload, issue.id, SIMILAR_TICKETS, 'issue') : []
  return {
    ...none,
    statements: statements.rows.map((row) => idRow.parse(row).id),
    similar: similar.map((hit) => hit.id),
  }
}

export const rememberContext = async (payload: Payload, runId: number, selected: StoredContext) => {
  const stored = await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "context" = ${JSON.stringify(selected)}::jsonb, "updated_at" = now()
    WHERE "id" = ${runId} AND "context" IS NULL RETURNING "context"`)
  if (stored.rows[0]) return selected
  const current = await payload.db.drizzle.execute(sql`SELECT "context" FROM "stage_runs" WHERE "id" = ${runId}`)
  return contextSchema.parse(current.rows[0]?.context)
}

export const partsOf = async (
  payload: Payload,
  stored: StoredRecord,
  context: StoredContext,
): Promise<ContextParts> => ({
  agentsFile: context.agentsFile.given
    ? await loadAgentsFile(payload, stored.workspace, stored.record.source.repo)
    : null,
  statements: await loadStatements(payload, context.statements),
  similar: await loadSimilar(payload, context.similar),
})
