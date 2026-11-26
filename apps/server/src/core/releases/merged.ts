import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export type MergedTicket = {
  recordId: number
  number: number
  title: string
  mergedAt: string
  visible: boolean
  breaking: boolean
  acceptedAt: string | null
}

const data = z.object({
  result: z.object({ changes: z.array(z.object({ tag: z.string() })) }).nullish(),
})
const row = z.object({
  record_id: z.coerce.number(),
  source_number: z.coerce.number(),
  title: z.string().nullable(),
  merged_at: z.coerce.date(),
  accepted_at: z.coerce.date().nullable(),
  data: z.unknown(),
  pr_title: z.string().nullable(),
  pr_labels: z.array(z.string()).catch([]),
  issue_labels: z.array(z.string()).catch([]),
})

const BREAKING_TITLE = /^[a-z]+(\([^)]*\))?!:/i

const isBreaking = (title: string | null, labels: string[]): boolean =>
  BREAKING_TITLE.test(title ?? '') || labels.some((label) => label.toLowerCase() === 'breaking')

export const mergedTickets = async (payload: Payload, source: number): Promise<MergedTicket[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT r."id" AS record_id, r."source_number", t."title", i."forge_closed_at" AS merged_at, r."data",
      i."title" AS pr_title, i."labels" AS pr_labels, t."labels" AS issue_labels,
      (SELECT min(e."created_at") FROM "events" e
        WHERE e."record_id" = r."id" AND e."type" IN ('result.accepted', 'ticket.done-elsewhere')) AS accepted_at
    FROM "mirror_items" i
    JOIN "records" r ON r."workspace_id" = i."workspace_id" AND r."source_repo" = i."repo" AND r."pr" = i."number"
    LEFT JOIN "mirror_items" t ON t."workspace_id" = r."workspace_id" AND t."repo" = r."source_repo"
      AND t."number" = r."source_number" AND t."kind" = 'issue'
    WHERE i."source_id" = ${source} AND i."kind" = 'pr' AND i."state" = 'merged' AND i."gone_at" IS NULL
      AND i."forge_closed_at" IS NOT NULL
    ORDER BY i."forge_closed_at" DESC, r."id" DESC`)
  return found.rows.map((entry) => {
    const parsed = row.parse(entry)
    const changes = data.safeParse(parsed.data).data?.result?.changes ?? []
    return {
      recordId: parsed.record_id,
      number: parsed.source_number,
      title: parsed.title ?? `#${parsed.source_number}`,
      mergedAt: parsed.merged_at.toISOString(),
      visible: changes.some((change) => change.tag === 'visible'),
      breaking: isBreaking(parsed.pr_title, [...parsed.pr_labels, ...parsed.issue_labels]),
      acceptedAt: parsed.accepted_at?.toISOString() ?? null,
    }
  })
}
