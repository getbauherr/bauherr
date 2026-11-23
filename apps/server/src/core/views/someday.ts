import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export type SomedayCount = {
  product: number
  forge: 'github' | 'gitlab'
  repo: string
  config: Record<string, unknown>
  count: number
}

export type SomedayFilter = { workspace: number; product?: number }

const row = z.object({
  product_id: z.coerce.number(),
  forge: z.enum(['github', 'gitlab']),
  repo: z.string(),
  config: z.record(z.string(), z.unknown()).nullable(),
  held: z.coerce.number(),
})

export const somedayCounts = async (payload: Payload, f: SomedayFilter): Promise<SomedayCount[]> => {
  const product = f.product ?? null
  const result = await payload.db.drizzle.execute(sql`
    SELECT p."id" AS product_id, c."kind"::text AS forge, i."repo", c."config", count(*) AS held
    FROM "mirror_items" i
    JOIN "products" p ON p."id" = i."product_id"
    JOIN "ticket_sources" s ON s."id" = i."source_id"
    JOIN "connections" c ON c."id" = s."connection_id"
    LEFT JOIN "records" r ON r."workspace_id" = i."workspace_id" AND r."source_forge" = c."kind"::text
      AND r."source_repo" = i."repo" AND r."source_number" = i."number"
    WHERE i."workspace_id" = ${f.workspace} AND r."id" IS NULL AND i."kind" = 'issue' AND i."state" = 'open'
      AND i."gone_at" IS NULL AND (${product}::integer IS NULL OR i."product_id" = ${product})
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(i."labels") l
        WHERE coalesce(p."intake_excluded_labels", '[]'::jsonb) @> to_jsonb(l))
    GROUP BY p."id", c."kind", i."repo", c."config" ORDER BY p."id", i."repo"`)
  return result.rows.map((found) => {
    const parsed = row.parse(found)
    return {
      product: parsed.product_id,
      forge: parsed.forge,
      repo: parsed.repo,
      config: parsed.config ?? {},
      count: parsed.held,
    }
  })
}
