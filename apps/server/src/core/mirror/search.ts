import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { anyWord, queryWords, sharedWords, sharesEnough } from './match'

export type ItemFilter = {
  workspace: number
  product?: number
  query: string
  kind?: 'issue' | 'pr'
  state?: 'open' | 'closed' | 'merged'
  limit: number
}

export type ItemHit = {
  id: number
  repo: string
  number: number
  kind: 'issue' | 'pr'
  title: string
  state: 'open' | 'closed' | 'merged'
  url: string
  rank: number
}

const hitSchema = z.object({
  id: z.coerce.number(),
  repo: z.string(),
  number: z.coerce.number(),
  kind: z.enum(['issue', 'pr']),
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  url: z.string().nullable(),
  rank: z.coerce.number(),
})

const ownRowSchema = z.object({ title: z.string(), product_id: z.coerce.number(), workspace_id: z.coerce.number() })

const vector = sql`to_tsvector('simple', coalesce(i."title", '') || ' ' || coalesce(i."body", ''))`

const toHit = (row: unknown): ItemHit => {
  const parsed = hitSchema.parse(row)
  return {
    id: parsed.id,
    repo: parsed.repo,
    number: parsed.number,
    kind: parsed.kind,
    title: parsed.title,
    state: parsed.state,
    url: parsed.url ?? '',
    rank: parsed.rank,
  }
}

const rankedBy = async (
  payload: Payload,
  scope: ReturnType<typeof sql>,
  query: string,
  limit: number,
): Promise<ItemHit[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."id", i."repo", i."number", i."kind", i."title", i."state", i."url",
      ts_rank(${vector}, websearch_to_tsquery('simple', ${query})) AS "rank"
    FROM "mirror_items" i
    WHERE i."gone_at" IS NULL AND ${scope}
      AND ${vector} @@ websearch_to_tsquery('simple', ${query})
    ORDER BY "rank" DESC, i."forge_updated_at" DESC NULLS LAST, i."id"
    LIMIT ${limit}`)
  return result.rows.map(toHit)
}

export const searchItems = async (payload: Payload, filter: ItemFilter): Promise<ItemHit[]> => {
  const scope = sql`i."workspace_id" = ${filter.workspace}
    ${filter.product === undefined ? sql`` : sql`AND i."product_id" = ${filter.product}`}
    ${filter.kind === undefined ? sql`` : sql`AND i."kind" = ${filter.kind}`}
    ${filter.state === undefined ? sql`` : sql`AND i."state" = ${filter.state}`}`
  return rankedBy(payload, scope, filter.query, filter.limit)
}

export const similarItems = async (
  payload: Payload,
  itemId: number,
  limit: number,
  kind?: ItemHit['kind'],
): Promise<ItemHit[]> => {
  const own = await payload.db.drizzle.execute(
    sql`SELECT "title", "product_id", "workspace_id" FROM "mirror_items" WHERE "id" = ${itemId}`,
  )
  const row = own.rows[0]
  if (!row) return []
  const item = ownRowSchema.parse(row)
  const words = queryWords(item.title)
  if (words.length === 0) return []
  const shared = sharedWords(vector, words)
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."id", i."repo", i."number", i."kind", i."title", i."state", i."url",
      ts_rank(${vector}, ${anyWord(words)}) AS "rank"
    FROM "mirror_items" i
    WHERE i."gone_at" IS NULL AND i."workspace_id" = ${item.workspace_id} AND i."product_id" = ${item.product_id}
      AND i."id" <> ${itemId} ${kind === undefined ? sql`` : sql`AND i."kind" = ${kind}`}
      AND ${vector} @@ ${anyWord(words)} AND ${sharesEnough(vector, words)}
    ORDER BY ${shared} DESC, "rank" DESC, i."forge_updated_at" DESC NULLS LAST, i."id" DESC
    LIMIT ${limit}`)
  return result.rows.map(toHit)
}
