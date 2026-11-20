import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export type AdoptablePull = {
  state: 'open' | 'closed' | 'merged'
  draft: boolean
  gone: boolean
  authorIsBot: boolean
  authorTrusted: boolean
  createdAt: string
  connectedAt: string | null
  headSha: string
}

export type LinkedIssue = {
  number: number
  state: 'open' | 'closed' | 'merged'
  gone: boolean
  labels: string[]
  hasRecord: boolean
}

export type Adoption = { adopt: true; issue: number } | { adopt: false; reason: string }

type Skip = { reason: string; applies: (pull: AdoptablePull) => boolean }

const SKIPS: Skip[] = [
  { reason: 'closed', applies: (pull) => pull.state !== 'open' },
  { reason: 'draft', applies: (pull) => pull.draft },
  { reason: 'gone', applies: (pull) => pull.gone },
  { reason: 'no-head-commit', applies: (pull) => pull.headSha === '' },
  { reason: 'bot', applies: (pull) => pull.authorIsBot },
  { reason: 'outside-author', applies: (pull) => !pull.authorTrusted },
  {
    reason: 'opened-after-connect',
    applies: (pull) => pull.connectedAt === null || Date.parse(pull.createdAt) >= Date.parse(pull.connectedAt),
  },
]

const skipped = (reason: string): Adoption => ({ adopt: false, reason })

export const adoption = (pull: AdoptablePull, linked: LinkedIssue[], excludedLabels: string[]): Adoption => {
  const skip = SKIPS.find((rule) => rule.applies(pull))
  if (skip) return skipped(skip.reason)
  const open = linked.filter((issue) => issue.state === 'open' && !issue.gone)
  const [issue] = open
  if (issue === undefined) return skipped('no-open-issue')
  if (open.length > 1) return skipped('several-issues')
  if (issue.labels.some((label) => excludedLabels.includes(label))) return skipped('excluded-label')
  if (issue.hasRecord) return skipped('has-record')
  return { adopt: true, issue: issue.number }
}

export type AdoptionCandidate = {
  workspace: number
  product: number
  forge: 'github' | 'gitlab'
  repo: string
  pr: number
  headSha: string
  author: string
  issue: number
  issueAuthor: string
  issueTrusted: boolean
  issueCreatedAt: string
  connectedAt: string | null
  imported: boolean
}

const count = z.coerce.number()

const rowSchema = z.object({
  workspace_id: count,
  product_id: count,
  forge: z.enum(['github', 'gitlab']),
  repo: z.string(),
  number: count,
  head_sha: z.string().nullable(),
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  gone: z.boolean(),
  author: z.string().nullable(),
  author_trusted: z.boolean().nullable(),
  author_is_bot: z.boolean().nullable(),
  forge_created_at: z.coerce.date(),
  connected_at: z.coerce.date().nullable(),
  imported: z.boolean(),
  excluded: z.array(z.string()).nullable(),
  linked: z.array(
    z.object({
      number: count,
      state: z.enum(['open', 'closed', 'merged']),
      gone: z.boolean(),
      labels: z.array(z.string()),
      has_record: z.boolean(),
      author: z.string().nullable(),
      author_trusted: z.boolean().nullable(),
      created_at: z.coerce.date(),
    }),
  ),
})

type Row = z.infer<typeof rowSchema>

const pullOf = (row: Row): AdoptablePull => ({
  state: row.state,
  draft: row.draft,
  gone: row.gone,
  authorIsBot: row.author_is_bot === true,
  authorTrusted: row.author_trusted === true,
  createdAt: row.forge_created_at.toISOString(),
  connectedAt: row.connected_at?.toISOString() ?? null,
  headSha: row.head_sha ?? '',
})

const linkedOf = (row: Row): LinkedIssue[] =>
  row.linked.map((i) => ({ number: i.number, state: i.state, gone: i.gone, labels: i.labels, hasRecord: i.has_record }))

const candidateOf = (row: Row, pull: AdoptablePull, issue: number): AdoptionCandidate => {
  const linked = row.linked.find((i) => i.number === issue)
  return {
    workspace: row.workspace_id,
    product: row.product_id,
    forge: row.forge,
    repo: row.repo,
    pr: row.number,
    headSha: pull.headSha,
    author: row.author ?? '',
    issue,
    issueAuthor: linked?.author ?? '',
    issueTrusted: linked?.author_trusted === true,
    issueCreatedAt: linked?.created_at.toISOString() ?? pull.createdAt,
    connectedAt: pull.connectedAt,
    imported: row.imported,
  }
}

const query = (product: number | null) => sql`
    SELECT pr."workspace_id", pr."product_id", c."kind"::text AS forge, pr."repo", pr."number", pr."head_sha",
      pr."state", pr."draft", (pr."gone_at" IS NOT NULL) AS gone, pr."author", pr."author_trusted",
      pr."author_is_bot", pr."forge_created_at", p."connected_at", (s."imported_at" IS NOT NULL) AS imported,
      p."intake_excluded_labels" AS excluded,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object('number', i."number", 'state', i."state",
          'gone', i."gone_at" IS NOT NULL, 'labels', i."labels", 'author', i."author",
          'author_trusted', i."author_trusted", 'created_at', i."forge_created_at", 'has_record', EXISTS (
            SELECT 1 FROM "records" r WHERE r."workspace_id" = i."workspace_id" AND r."source_forge" = c."kind"::text
              AND r."source_repo" = i."repo" AND r."source_number" = i."number")))
        FROM jsonb_array_elements_text(pr."closes") AS n
        JOIN "mirror_items" i ON i."workspace_id" = pr."workspace_id" AND i."repo" = pr."repo"
          AND i."kind" = 'issue' AND i."number" = n::integer
      ), '[]'::jsonb) AS linked
    FROM "mirror_items" pr
    JOIN "workspaces" w ON w."id" = pr."workspace_id" AND w."archived_at" IS NULL
    JOIN "products" p ON p."id" = pr."product_id"
    JOIN "ticket_sources" s ON s."id" = pr."source_id"
    JOIN "connections" c ON c."id" = s."connection_id"
    WHERE pr."kind" = 'pr' AND pr."state" = 'open' AND pr."gone_at" IS NULL AND jsonb_array_length(pr."closes") > 0
      AND (${product}::integer IS NULL OR pr."product_id" = ${product})
    ORDER BY pr."forge_created_at", pr."id"`

export const loadAdoptions = async (payload: Payload, product: number | null): Promise<AdoptionCandidate[]> => {
  const result = await payload.db.drizzle.execute(query(product))
  const adopted: AdoptionCandidate[] = []
  const taken = new Set<string>()
  for (const raw of result.rows) {
    const row = rowSchema.parse(raw)
    const pull = pullOf(row)
    const outcome = adoption(pull, linkedOf(row), row.excluded ?? [])
    if (!outcome.adopt) continue
    const key = `${row.workspace_id}/${row.repo}#${outcome.issue}`
    if (taken.has(key)) continue
    taken.add(key)
    adopted.push(candidateOf(row, pull, outcome.issue))
  }
  return adopted
}
