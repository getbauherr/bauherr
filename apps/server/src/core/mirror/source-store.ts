import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { count, instant, iso } from './row-values'

export type SourceRow = {
  id: number
  workspace: number
  repo: string
  product: number
  connection: number
  cursor: string | null
  lookbackAt: string | null
  reconciledAt: string | null
  importedAt: string | null
  factsAt: string | null
}

export type SourcePatch = {
  cursor?: string
  lookbackAt?: Date
  reconciledAt?: Date
  importedAt?: Date
  error: string | null
  polledAt: Date
}


const sourceRowSchema = z.object({
  id: count,
  workspace_id: count,
  repo: z.string(),
  product_id: count,
  connection_id: count,
  cursor: z.string().nullable(),
  lookback_at: instant,
  reconciled_at: instant,
  imported_at: instant,
  facts_at: instant,
})

const toSource = (row: unknown): SourceRow => {
  const parsed = sourceRowSchema.parse(row)
  return {
    id: parsed.id,
    workspace: parsed.workspace_id,
    repo: parsed.repo,
    product: parsed.product_id,
    connection: parsed.connection_id,
    cursor: parsed.cursor,
    lookbackAt: iso(parsed.lookback_at),
    reconciledAt: iso(parsed.reconciled_at),
    importedAt: iso(parsed.imported_at),
    factsAt: iso(parsed.facts_at),
  }
}

const SOURCE_COLUMNS = sql`s."id", s."workspace_id", s."repo", s."product_id", s."connection_id", s."cursor",
  s."lookback_at", s."reconciled_at", s."imported_at", s."facts_at"`

export const liveSources = async (payload: Payload): Promise<SourceRow[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT ${SOURCE_COLUMNS}
    FROM "ticket_sources" s
    JOIN "workspaces" w ON w."id" = s."workspace_id" AND w."archived_at" IS NULL
    ORDER BY s."id"`)
  return result.rows.map(toSource)
}

export const liveSource = async (payload: Payload, id: number): Promise<SourceRow | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT ${SOURCE_COLUMNS}
    FROM "ticket_sources" s
    JOIN "workspaces" w ON w."id" = s."workspace_id" AND w."archived_at" IS NULL
    WHERE s."id" = ${id}`)
  return result.rows[0] ? toSource(result.rows[0]) : null
}

export const saveCursor = async (payload: Payload, id: number, cursor: string): Promise<void> => {
  await payload.db.drizzle.execute(
    sql`UPDATE "ticket_sources" SET "cursor" = ${cursor}, "updated_at" = now() WHERE "id" = ${id}`,
  )
}

export const finishSource = async (payload: Payload, id: number, patch: SourcePatch): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "ticket_sources" SET
      "cursor" = COALESCE(${patch.cursor ?? null}, "cursor"),
      "lookback_at" = COALESCE(${iso(patch.lookbackAt ?? null)}::timestamptz, "lookback_at"),
      "reconciled_at" = COALESCE(${iso(patch.reconciledAt ?? null)}::timestamptz, "reconciled_at"),
      "imported_at" = COALESCE(${iso(patch.importedAt ?? null)}::timestamptz, "imported_at"),
      "last_error" = ${patch.error},
      "last_polled_at" = ${patch.polledAt.toISOString()}::timestamptz,
      "updated_at" = now()
    WHERE "id" = ${id}`)
}
