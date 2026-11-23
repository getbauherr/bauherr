import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

const count = z.coerce.number()

const awaitingMergeRow = z.object({
  id: count,
  number: count,
  head_sha: z.string(),
  base_ref: z.string(),
  merge_check: z.string().nullable(),
})

export type AwaitingMerge = { itemId: number; number: number; headSha: string; baseRef: string; checked: string | null }

export const pullsAwaitingMergeability = async (payload: Payload, source: number): Promise<AwaitingMerge[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."id", i."number", i."head_sha", i."base_ref", i."merge_check" FROM "mirror_items" i
    JOIN "records" r ON r."workspace_id" = i."workspace_id" AND r."source_repo" = i."repo" AND r."pr" = i."number"
      AND r."waiting_on" <> 'nobody' AND r."stage" IN ('verify', 'ship')
    WHERE i."source_id" = ${source} AND i."kind" = 'pr' AND i."state" = 'open' AND i."gone_at" IS NULL
      AND coalesce(i."head_sha", '') <> '' AND coalesce(i."base_ref", '') <> ''`)
  return result.rows.map((row) => {
    const parsed = awaitingMergeRow.parse(row)
    return {
      itemId: parsed.id,
      number: parsed.number,
      headSha: parsed.head_sha,
      baseRef: parsed.base_ref,
      checked: parsed.merge_check,
    }
  })
}

export const saveMergeability = async (
  payload: Payload,
  item: number,
  mergeCheck: string | null,
  conflictSha: string | null,
): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "mirror_items" SET "merge_check" = ${mergeCheck}, "conflict_sha" = ${conflictSha}, "updated_at" = now()
    WHERE "id" = ${item}`)
}
