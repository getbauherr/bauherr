import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { runStageOf } from '../memory'
import type { AgentsFile } from '../mirror/facts'
import { similarItems } from '../mirror/search'
import type { StoredRecord } from '../record/store'
import { closedAsOf, endedOf } from '../views/rows'
import { TERMINAL_LIST } from '../views/sql'
import { selectDocumentParts } from '../memory-documents'
import { contextSchema, type Run, type StoredContext } from './schema'

export const SIMILAR_TICKETS = 3

export type PackSimilar = {
  number: number
  title: string
  state: 'open' | 'closed' | 'merged'
  url: string
  record: { goal: string; outcome: 'accepted' | 'closed' | 'open'; reason: string | null } | null
}

export type ContextParts = {
  agentsFile: AgentsFile | null
  similar: PackSimilar[]
}

const count = z.coerce.number()

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
  run: Pick<Run, 'stage' | 'role'>,
  stored: StoredRecord,
): Promise<StoredContext> => {
  const agents = await loadAgentsFile(payload, stored.workspace, stored.record.source.repo)
  const none = { similar: [], agentsFile: { given: agents !== null, cut: agents?.cut ?? false } }
  const found = await payload.db.drizzle.execute(sql`
    SELECT i."id", i."title", r."product_id" FROM "records" r
    LEFT JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = r."source_number" AND i."kind" = 'issue'
    WHERE r."id" = ${stored.id}`)
  const issue = issueRow.parse(found.rows[0])
  const stage = runStageOf(run.stage, run.role)
  const similar =
    run.stage === 'brief' && issue.id !== null ? await similarItems(payload, issue.id, SIMILAR_TICKETS, 'issue') : []
  const memory = stage
    ? await selectDocumentParts(payload, { workspace: stored.workspace, product: issue.product_id }, stage)
    : []
  return { ...none, memory, similar: similar.map((hit) => hit.id) }
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
  similar: await loadSimilar(payload, context.similar),
})
