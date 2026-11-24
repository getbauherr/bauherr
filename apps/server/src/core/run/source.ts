import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { DISCLOSURE } from '../forge/disclosure'
import type { StoredRecord } from '../record/store'

export const BODY_LIMIT = 8000
export const COMMENT_LIMIT = 2000
export const COMMENTS_LIMIT = 30

export type SourceText = { number: number; title: string; author: string | null; body: string; bodyCut: boolean }

export type SourceComment = { author: string | null; at: string | null; factory: boolean; body: string; cut: boolean }

export type PackSource = {
  issue: SourceText
  comments: SourceComment[]
  olderCommentsLeftOut: number
  pull: SourceText | null
}

const itemRow = z.object({
  id: z.coerce.number(),
  number: z.coerce.number(),
  title: z.string(),
  author: z.string().nullable(),
  body: z.string().nullable(),
})

const commentRow = z.object({
  author: z.string().nullable(),
  body: z.string().nullable(),
  at: z.coerce.date().nullable(),
})

const textOf = (row: z.infer<typeof itemRow>): SourceText => {
  const body = row.body ?? ''
  return {
    number: row.number,
    title: row.title,
    author: row.author,
    body: body.slice(0, BODY_LIMIT),
    bodyCut: body.length > BODY_LIMIT,
  }
}

const loadItem = async (payload: Payload, stored: StoredRecord, kind: 'issue' | 'pr', number: number) => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "number", "title", "author", "body" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${stored.record.source.repo}
      AND "kind" = ${kind} AND "number" = ${number}`)
  return found.rows[0] ? itemRow.parse(found.rows[0]) : null
}

export const loadSource = async (payload: Payload, stored: StoredRecord): Promise<PackSource | null> => {
  const issue = await loadItem(payload, stored, 'issue', stored.record.source.number)
  if (!issue) return null
  const adopted = stored.record.source.adopted
  const pull = adopted ? await loadItem(payload, stored, 'pr', adopted.pr) : null
  const found = await payload.db.drizzle.execute(sql`
    SELECT "author", "body", "forge_created_at" AS "at" FROM (
      SELECT "id", "author", "body", "forge_created_at" FROM "mirror_comments" WHERE "item_id" = ${issue.id}
      ORDER BY "forge_created_at" DESC NULLS LAST, "id" DESC LIMIT ${COMMENTS_LIMIT}
    ) latest ORDER BY "forge_created_at" ASC NULLS FIRST, "id" ASC`)
  const total = await payload.db.drizzle.execute(
    sql`SELECT count(*) AS "count" FROM "mirror_comments" WHERE "item_id" = ${issue.id}`,
  )
  const comments = found.rows.map((raw) => {
    const row = commentRow.parse(raw)
    const body = row.body ?? ''
    return {
      author: row.author,
      at: row.at?.toISOString() ?? null,
      factory: body.trimStart().startsWith(DISCLOSURE),
      body: body.slice(0, COMMENT_LIMIT),
      cut: body.length > COMMENT_LIMIT,
    }
  })
  return {
    issue: textOf(issue),
    comments,
    olderCommentsLeftOut: z.coerce.number().parse(total.rows[0]?.count) - comments.length,
    pull: pull ? textOf(pull) : null,
  }
}
