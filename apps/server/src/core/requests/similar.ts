import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'does', 'what', 'when', 'they', 'them', 'there', 'the'])

const words = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9äöüß]+/)
      .filter((word) => word.length >= 3 && !STOP.has(word)),
  )

export type SimilarRequest = { number: number; title: string; url: string }

const rowSchema = z.object({ number: z.coerce.number(), title: z.string(), url: z.string().nullable() })

export const similarOpen = async (
  payload: Payload,
  where: { workspace: number; product: number },
  text: string,
): Promise<SimilarRequest | null> => {
  const mine = words(text)
  const found = await payload.db.drizzle.execute(sql`
    SELECT "number", "title", "url" FROM "mirror_items"
    WHERE "workspace_id" = ${where.workspace} AND "product_id" = ${where.product} AND "kind" = 'issue'
      AND "state" = 'open' AND "gone_at" IS NULL`)
  let best: { item: SimilarRequest; score: number } | null = null
  for (const raw of found.rows) {
    const item = rowSchema.parse(raw)
    const theirs = words(item.title)
    const shared = [...theirs].filter((word) => mine.has(word)).length
    const score = theirs.size === 0 ? 0 : shared / theirs.size
    if (shared >= 3 && score >= 0.6 && (best === null || score > best.score)) {
      best = { item: { number: item.number, title: item.title, url: item.url ?? '' }, score }
    }
  }
  return best?.item ?? null
}
