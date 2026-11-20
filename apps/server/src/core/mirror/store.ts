import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { CheckRow, CommentRow, ItemRow } from './map'

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
}

export type ItemContext = {
  workspace: number
  product: number
  source: number
  repo: string
  touched?: Set<number>
}
export type KnownItem = { id: number; updatedMs: number | null; gone: boolean }
export type SourcePatch = {
  cursor?: string
  lookbackAt?: Date
  reconciledAt?: Date
  importedAt?: Date
  error: string | null
  polledAt: Date
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())
const instant = z.coerce.date().nullable()
const count = z.coerce.number()
const json = (value: unknown) => JSON.stringify(value)

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
})

const knownRowSchema = z.object({
  id: count,
  number: count,
  forge_updated_at: instant,
  gone_at: instant,
})

const openRowSchema = z.object({ number: count, kind: z.enum(['issue', 'pr']) })
const idRowSchema = z.object({ id: count })
const numberRowSchema = z.object({ number: count })
const latestRowSchema = z.object({ latest: instant })

export const liveSources = async (payload: Payload): Promise<SourceRow[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT s."id", s."workspace_id", s."repo", s."product_id", s."connection_id", s."cursor",
      s."lookback_at", s."reconciled_at", s."imported_at"
    FROM "ticket_sources" s
    JOIN "workspaces" w ON w."id" = s."workspace_id" AND w."archived_at" IS NULL
    ORDER BY s."id"`)
  return result.rows.map((row) => {
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
    }
  })
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

export const knownItems = async (
  payload: Payload,
  source: number,
  numbers: number[],
): Promise<Map<number, KnownItem>> => {
  if (numbers.length === 0) return new Map()
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "number", "forge_updated_at", "gone_at" FROM "mirror_items"
    WHERE "source_id" = ${source} AND "number" IN (${sql.join(numbers.map((n) => sql`${n}`), sql`, `)})`)
  const known = new Map<number, KnownItem>()
  for (const row of result.rows) {
    const parsed = knownRowSchema.parse(row)
    known.set(parsed.number, {
      id: parsed.id,
      updatedMs: parsed.forge_updated_at?.getTime() ?? null,
      gone: parsed.gone_at !== null,
    })
  }
  return known
}

const DATA = sql`("title", "body", "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url",
  "forge_created_at", "forge_updated_at", "forge_closed_at", "head_sha", "head_ref", "merge_sha", "closes", "draft",
  "kind")`
const INCOMING = sql`(excluded."title", excluded."body", excluded."state", excluded."author",
  excluded."author_trusted", excluded."author_is_bot", excluded."labels", excluded."assignees", excluded."url",
  excluded."forge_created_at", excluded."forge_updated_at", excluded."forge_closed_at", excluded."head_sha",
  excluded."head_ref", excluded."merge_sha", excluded."closes", excluded."draft", excluded."kind")`
const STORED = sql`(m."title", m."body", m."state", m."author", m."author_trusted", m."author_is_bot", m."labels",
  m."assignees", m."url", m."forge_created_at", m."forge_updated_at", m."forge_closed_at", m."head_sha",
  m."head_ref", m."merge_sha", m."closes", m."draft", m."kind")`

export const upsertItem = async (
  payload: Payload,
  context: ItemContext,
  row: ItemRow,
  now: Date,
): Promise<number> => {
  const result = await payload.db.drizzle.execute(sql`
    INSERT INTO "mirror_items" AS m ("workspace_id", "source_id", "product_id", "repo", "number", "kind", "title",
      "body", "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url", "forge_created_at",
      "forge_updated_at", "forge_closed_at", "head_sha", "head_ref", "merge_sha", "closes", "draft", "synced_at",
      "gone_at", "updated_at", "created_at")
    VALUES (${context.workspace}, ${context.source}, ${context.product}, ${context.repo}, ${row.number}, ${row.kind},
      ${row.title}, ${row.body}, ${row.state}, ${row.author}, ${row.authorTrusted}, ${row.authorIsBot},
      ${json(row.labels)}::jsonb, ${json(row.assignees)}::jsonb, ${row.url}, ${iso(row.forgeCreatedAt)}::timestamptz,
      ${iso(row.forgeUpdatedAt)}::timestamptz, ${iso(row.forgeClosedAt)}::timestamptz, ${row.headSha}, ${row.headRef},
      ${row.mergeSha}, ${json(row.closes)}::jsonb, ${row.draft}, ${now.toISOString()}::timestamptz, NULL, now(), now())
    ON CONFLICT ("workspace_id", "repo", "number") DO UPDATE SET
      ${DATA} = ${INCOMING},
      "source_id" = excluded."source_id",
      "product_id" = excluded."product_id",
      "synced_at" = excluded."synced_at",
      "gone_at" = NULL,
      "updated_at" = CASE WHEN ${STORED} IS DISTINCT FROM ${INCOMING} OR m."gone_at" IS NOT NULL
        THEN now() ELSE m."updated_at" END
    RETURNING "id"`)
  const id = idRowSchema.parse(result.rows[0]).id
  context.touched?.add(id)
  return id
}

export const latestCommentAt = async (payload: Payload, item: number): Promise<string | null> => {
  const result = await payload.db.drizzle.execute(
    sql`SELECT max("forge_updated_at") AS "latest" FROM "mirror_comments" WHERE "item_id" = ${item}`,
  )
  return iso(latestRowSchema.parse(result.rows[0]).latest)
}

export const upsertComments = async (
  payload: Payload,
  workspace: number,
  item: number,
  rows: CommentRow[],
): Promise<void> => {
  for (const row of rows) {
    await payload.db.drizzle.execute(sql`
      INSERT INTO "mirror_comments" AS m ("workspace_id", "item_id", "forge_id", "author", "body",
        "forge_created_at", "forge_updated_at", "updated_at", "created_at")
      VALUES (${workspace}, ${item}, ${row.forgeId}, ${row.author}, ${row.body},
        ${iso(row.forgeCreatedAt)}::timestamptz, ${iso(row.forgeUpdatedAt)}::timestamptz, now(), now())
      ON CONFLICT ("item_id", "forge_id") DO UPDATE SET
        "author" = excluded."author", "body" = excluded."body",
        "forge_created_at" = excluded."forge_created_at", "forge_updated_at" = excluded."forge_updated_at",
        "updated_at" = CASE WHEN (m."author", m."body", m."forge_updated_at")
          IS DISTINCT FROM (excluded."author", excluded."body", excluded."forge_updated_at")
          THEN now() ELSE m."updated_at" END`)
  }
}

export const upsertChecks = async (
  payload: Payload,
  workspace: number,
  item: number,
  rows: CheckRow[],
): Promise<void> => {
  for (const row of rows) {
    await payload.db.drizzle.execute(sql`
      INSERT INTO "mirror_checks" AS m ("workspace_id", "item_id", "sha", "name", "status", "conclusion", "url",
        "forge_updated_at", "updated_at", "created_at")
      VALUES (${workspace}, ${item}, ${row.sha}, ${row.name}, ${row.status}, ${row.conclusion}, ${row.url},
        ${iso(row.forgeUpdatedAt)}::timestamptz, now(), now())
      ON CONFLICT ("item_id", "sha", "name") DO UPDATE SET
        "status" = excluded."status", "conclusion" = excluded."conclusion", "url" = excluded."url",
        "forge_updated_at" = excluded."forge_updated_at",
        "updated_at" = CASE WHEN (m."status", m."conclusion", m."url", m."forge_updated_at")
          IS DISTINCT FROM (excluded."status", excluded."conclusion", excluded."url", excluded."forge_updated_at")
          THEN now() ELSE m."updated_at" END`)
  }
}

export const pullsAwaitingChecks = async (payload: Payload, source: number): Promise<Set<number>> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."number" FROM "mirror_items" i
    WHERE i."source_id" = ${source} AND i."kind" = 'pr' AND i."state" = 'open' AND i."gone_at" IS NULL
      AND coalesce(i."head_sha", '') <> '' AND (
        NOT EXISTS (SELECT 1 FROM "mirror_checks" c WHERE c."item_id" = i."id" AND c."sha" = i."head_sha")
        OR EXISTS (SELECT 1 FROM "mirror_checks" c
          WHERE c."item_id" = i."id" AND c."sha" = i."head_sha" AND c."status" <> 'completed'))`)
  return new Set(result.rows.map((row) => numberRowSchema.parse(row).number))
}

export const openItems = async (
  payload: Payload,
  source: number,
): Promise<{ number: number; kind: 'issue' | 'pr' }[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "number", "kind" FROM "mirror_items"
    WHERE "source_id" = ${source} AND "state" = 'open' AND "gone_at" IS NULL`)
  return result.rows.map((row) => openRowSchema.parse(row))
}

export const goneNumbers = async (payload: Payload, source: number): Promise<number[]> => {
  const result = await payload.db.drizzle.execute(
    sql`SELECT "number" FROM "mirror_items" WHERE "source_id" = ${source} AND "gone_at" IS NOT NULL`,
  )
  return result.rows.map((row) => numberRowSchema.parse(row).number)
}

export const setGone = async (payload: Payload, source: number, number: number, now: Date): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "mirror_items" SET "gone_at" = ${now.toISOString()}::timestamptz, "updated_at" = now()
    WHERE "source_id" = ${source} AND "number" = ${number} AND "gone_at" IS NULL`)
}

export const clearGone = async (payload: Payload, source: number, number: number): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "mirror_items" SET "gone_at" = NULL, "updated_at" = now()
    WHERE "source_id" = ${source} AND "number" = ${number} AND "gone_at" IS NOT NULL`)
}

const MIRROR_TABLES = ['mirror_checks', 'mirror_comments'] as const

const deleteMirror = async (payload: Payload, items: ReturnType<typeof sql>): Promise<void> => {
  const db = payload.db.drizzle
  await db.transaction(async (tx: typeof db) => {
    for (const table of MIRROR_TABLES) {
      await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE "item_id" IN (${items})`)
    }
    await tx.execute(sql`DELETE FROM "mirror_items" WHERE "id" IN (${items})`)
  })
}

export const deleteSourceMirror = (payload: Payload, source: number): Promise<void> =>
  deleteMirror(payload, sql`SELECT "id" FROM "mirror_items" WHERE "source_id" = ${source}`)

export const deleteProductMirror = (payload: Payload, product: number): Promise<void> =>
  deleteMirror(payload, sql`SELECT "id" FROM "mirror_items" WHERE "product_id" = ${product}`)
