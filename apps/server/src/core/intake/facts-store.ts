import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { similarItems } from '../mirror/search'
import type { StoredRecord } from '../record/store'
import { intakeFacts, SIMILAR_LIMIT, type FactsComment, type IntakeFacts } from './facts'

const itemRow = z.object({ id: z.coerce.number(), body: z.string().nullable() })
const commentRow = z.object({ author: z.string().nullable(), body: z.string().nullable(), at: z.coerce.date() })

export const loadIntakeFacts = async (payload: Payload, stored: StoredRecord): Promise<IntakeFacts> => {
  const { repo, number, reporter } = stored.record.source
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id", "body" FROM "mirror_items"
    WHERE "workspace_id" = ${stored.workspace} AND "repo" = ${repo} AND "number" = ${number} AND "kind" = 'issue'`)
  const item = found.rows[0] ? itemRow.parse(found.rows[0]) : null
  const comments: FactsComment[] = item
    ? (
        await payload.db.drizzle.execute(
          sql`SELECT "author", "body", "forge_created_at" AS at FROM "mirror_comments" WHERE "item_id" = ${item.id}`,
        )
      ).rows.map((row) => {
        const parsed = commentRow.parse(row)
        return { author: parsed.author ?? '', body: parsed.body ?? '', createdAt: parsed.at.toISOString() }
      })
    : []
  const hits = item ? await similarItems(payload, item.id, SIMILAR_LIMIT) : []
  const similar = hits.map((hit) => ({ number: hit.number, title: hit.title, state: hit.state }))
  return intakeFacts({ type: stored.record.type, body: item?.body ?? '', reporter, comments, similar })
}
