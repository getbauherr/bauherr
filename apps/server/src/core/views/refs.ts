import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stageSchema, type Stage } from '../events'
import { LIVE_SQL } from './sql'

export type TicketRef = { recordId: number; number: number; title: string; stage: Stage }

export type Sigil = '#' | '!'

export type TicketRefs = { byId: Map<number, TicketRef>; byMention: Map<string, TicketRef> }

const count = z.coerce.number()

const refRow = z.object({
  id: count,
  repo: z.string(),
  number: count,
  source_number: count,
  title: z.string().nullable(),
  stage: stageSchema,
  via_pull: z.boolean(),
  forge: z.enum(['github', 'gitlab']),
})

const mentionKey = (repo: string, number: number, sigil: Sigil): string => `${repo}${sigil}${number}`

const STAGE = sql`CASE WHEN ${LIVE_SQL} THEN r."stage" ELSE 'done' END`

export const loadTicketRefs = async (payload: Payload, workspace: number): Promise<TicketRefs> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT r."id", r."source_repo" AS repo, r."source_number" AS number, r."source_number", i."title",
      ${STAGE} AS stage, false AS via_pull, r."data"->'source'->>'forge' AS forge
    FROM "records" r
    LEFT JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = r."source_number"
    WHERE r."workspace_id" = ${workspace}
    UNION ALL
    SELECT r."id", pr."repo", pr."number", r."source_number", i."title", ${STAGE} AS stage, true AS via_pull,
      r."data"->'source'->>'forge' AS forge
    FROM "mirror_items" pr
    CROSS JOIN LATERAL jsonb_array_elements_text(pr."closes") AS closed(value)
    JOIN "records" r ON r."workspace_id" = pr."workspace_id" AND r."source_repo" = pr."repo"
      AND r."source_number" = closed.value::numeric
    LEFT JOIN "mirror_items" i ON i."workspace_id" = r."workspace_id" AND i."repo" = r."source_repo"
      AND i."number" = r."source_number"
    WHERE pr."workspace_id" = ${workspace} AND pr."kind" = 'pr' AND pr."gone_at" IS NULL
      AND jsonb_typeof(pr."closes") = 'array'`)
  const refs: TicketRefs = { byId: new Map(), byMention: new Map() }
  const rows = result.rows.map((raw) => refRow.parse(raw))
  for (const row of rows.toSorted((a, b) => Number(a.via_pull) - Number(b.via_pull))) {
    const ref = {
      recordId: row.id,
      number: row.source_number,
      title: row.title ?? `#${row.source_number}`,
      stage: row.stage,
    }
    const sigil = row.via_pull && row.forge === 'gitlab' ? '!' : '#'
    const key = mentionKey(row.repo, row.number, sigil)
    if (!refs.byMention.has(key)) refs.byMention.set(key, ref)
    if (!row.via_pull) refs.byId.set(row.id, ref)
  }
  return refs
}

export const resolveMention = (
  refs: TicketRefs,
  repo: string,
  number: number,
  sigil: Sigil = '#',
): TicketRef | null =>
  refs.byMention.get(mentionKey(repo, number, sigil)) ?? null
