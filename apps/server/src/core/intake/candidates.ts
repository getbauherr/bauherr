import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { READINESS_KEY } from '../readiness/tickets'
import { select, type IntakeItem, type IntakeSettings, type Selection } from './select'

export type Candidate = {
  itemId: number
  workspace: number
  product: number
  forge: 'github' | 'gitlab'
  repo: string
  number: number
  title: string
  url: string
  createdAt: string
  connectedAt: string | null
  imported: boolean
  memory: number | null
  readiness: string | null
  item: IntakeItem
  settings: IntakeSettings
}

export const DAY_MS = 86_400_000

const count = z.coerce.number()

const candidateRow = z.object({
  item_id: count,
  workspace_id: count,
  product_id: count,
  forge: z.enum(['github', 'gitlab']),
  repo: z.string(),
  number: count,
  title: z.string(),
  url: z.string().nullable(),
  forge_created_at: z.coerce.date(),
  connected_at: z.coerce.date().nullable(),
  imported: z.boolean(),
  memory_id: count.nullable(),
  readiness_check: z.string().nullable(),
  kind: z.enum(['issue', 'pr']),
  state: z.enum(['open', 'closed', 'merged']),
  gone: z.boolean(),
  author: z.string().nullable(),
  author_trusted: z.boolean().nullable(),
  author_is_bot: z.boolean().nullable(),
  labels: z.array(z.string()).nullable(),
  assignees: z.array(z.string()).nullable(),
  excluded: z.array(z.string()).nullable(),
  per_day: count.nullable(),
})

const admittedRow = z.object({ product_id: count, author: z.string(), admitted: count })

const toCandidate = (row: unknown): Candidate => {
  const r = candidateRow.parse(row)
  return {
    itemId: r.item_id,
    workspace: r.workspace_id,
    product: r.product_id,
    forge: r.forge,
    repo: r.repo,
    number: r.number,
    title: r.title,
    url: r.url ?? '',
    createdAt: r.forge_created_at.toISOString(),
    connectedAt: r.connected_at?.toISOString() ?? null,
    imported: r.imported,
    memory: r.memory_id,
    readiness: r.readiness_check,
    item: {
      kind: r.kind,
      state: r.state,
      gone: r.gone,
      author: r.author ?? '',
      authorTrusted: r.author_trusted === true,
      authorIsBot: r.author_is_bot === true,
      labels: r.labels ?? [],
      assignees: r.assignees ?? [],
    },
    settings: { excludedLabels: r.excluded ?? [], outsideIssuesPerDay: r.per_day ?? 5 },
  }
}

export const loadCandidates = async (payload: Payload, product: number | null): Promise<Candidate[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT i."id" AS item_id, i."workspace_id", i."product_id", c."kind"::text AS forge, i."repo", i."number",
      i."title", i."url", i."forge_created_at", p."connected_at", (s."imported_at" IS NOT NULL) AS imported,
      (SELECT st."id" FROM "statements" st WHERE st."product_id" = i."product_id" AND st."check_issue" = i."number"
        ORDER BY st."id" LIMIT 1) AS memory_id,
      (SELECT k."key" FROM "instance_state" st CROSS JOIN LATERAL jsonb_each_text(st."value") k
        WHERE st."key" = ${READINESS_KEY} || i."product_id"::text AND k."value" = i."number"::text
        LIMIT 1) AS readiness_check,
      i."kind", i."state",
      (i."gone_at" IS NOT NULL) AS gone,
      i."author", i."author_trusted", i."author_is_bot", i."labels", i."assignees",
      p."intake_excluded_labels" AS excluded, p."outside_issues_per_day" AS per_day
    FROM "mirror_items" i
    JOIN "workspaces" w ON w."id" = i."workspace_id" AND w."archived_at" IS NULL
    JOIN "products" p ON p."id" = i."product_id"
    JOIN "ticket_sources" s ON s."id" = i."source_id"
    JOIN "connections" c ON c."id" = s."connection_id"
    LEFT JOIN "records" r ON r."workspace_id" = i."workspace_id" AND r."source_forge" = c."kind"::text
      AND r."source_repo" = i."repo" AND r."source_number" = i."number"
    WHERE r."id" IS NULL AND i."kind" = 'issue' AND i."state" = 'open' AND i."gone_at" IS NULL
      AND (${product}::integer IS NULL OR i."product_id" = ${product})
    ORDER BY i."forge_created_at", i."id"`)
  return result.rows.map(toCandidate)
}

export const admittedToday = async (payload: Payload, now: Date): Promise<Map<number, Record<string, number>>> => {
  const since = new Date(now.getTime() - DAY_MS).toISOString()
  const result = await payload.db.drizzle.execute(sql`
    SELECT "product_id", "data"->'source'->>'reporter' AS author, count(*) AS admitted FROM "records"
    WHERE "created_at" >= ${since}::timestamptz AND ("data"->'source'->>'external')::boolean
    GROUP BY "product_id", "data"->'source'->>'reporter'`)
  const byProduct = new Map<number, Record<string, number>>()
  for (const row of result.rows) {
    const parsed = admittedRow.parse(row)
    byProduct.set(parsed.product_id, { ...byProduct.get(parsed.product_id), [parsed.author]: parsed.admitted })
  }
  return byProduct
}

export type Classified = { candidate: Candidate; selection: Selection }

export const askedByFactory = (candidate: Pick<Candidate, 'memory' | 'readiness'>): boolean =>
  candidate.memory !== null || candidate.readiness !== null

const asFactoryIssue = (candidate: Candidate): Candidate =>
  askedByFactory(candidate)
    ? { ...candidate, item: { ...candidate.item, authorTrusted: true, authorIsBot: false } }
    : candidate

const bump = (counts: Record<string, number>, author: string): Record<string, number> => ({
  ...counts,
  [author]: (counts[author] ?? 0) + 1,
})

export const classify = async (payload: Payload, now: Date, product: number | null): Promise<Classified[]> => {
  const admitted = await admittedToday(payload, now)
  const classified: Classified[] = []
  for (const loaded of await loadCandidates(payload, product)) {
    const candidate = asFactoryIssue(loaded)
    const counts = admitted.get(candidate.product) ?? {}
    const selection = select(candidate.item, candidate.settings, { admittedTodayByAuthor: counts })
    if (selection.action === 'enter' && !candidate.item.authorTrusted) {
      admitted.set(candidate.product, bump(counts, candidate.item.author))
    }
    classified.push({ candidate, selection })
  }
  return classified
}
