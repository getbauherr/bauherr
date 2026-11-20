import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { BranchProtection } from '../mirror/facts'
import { classifiedIn } from './classified'
import { ago } from './sql'

export type FirstLook = {
  issues: {
    open: number
    readyForBrief: number
    needingInformation: number
    closedAsDuplicate: number
    withoutActivityForAYear: number
    heldForOutsideAuthor: number
    assignedToPerson: number
  }
  pullRequests: { open: number; closingAnIssue: number; notClosingAnIssue: number }
  repository: {
    requiredChecks: string[]
    syncCompleted: boolean
    issuesMirrored: number
    pullRequestsMirrored: number
    suggestForgeChecks: boolean
    repositories: RepositoryFacts[]
  }
}

export type RepositoryFacts = {
  repo: string
  defaultBranch: string | null
  branchProtected: BranchProtection | null
  requiredChecksOnForge: string[]
  hasAgentsFile: boolean | null
  issueForms: number | null
  readAt: string | null
}

export type FirstLookFilter = { workspace: number; product: number; now: Date }

const count = z.coerce.number()

const mirrorRow = z.object({
  issues: count,
  open_issues: count,
  assigned: count,
  stale: count,
  pulls: count,
  open_pulls: count,
  closing: count,
})

const recordRow = z.object({ ready: count, needing: count, duplicates: count })

const sourceRow = z.object({ required: z.string().nullable(), sources: count, imported: count })

const factsRow = z.object({
  repo: z.string(),
  default_branch: z.string().nullable(),
  branch_protected: z.enum(['yes', 'no', 'unknown']).nullable(),
  required_check_names: z.array(z.string()).nullable(),
  has_agents_file: z.boolean().nullable(),
  issue_form_count: count.nullable(),
  facts_at: z.coerce.date().nullable(),
})

const repositoryFacts = async (payload: Payload, f: FirstLookFilter): Promise<RepositoryFacts[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "repo", "default_branch", "branch_protected", "required_check_names", "has_agents_file",
      "issue_form_count", "facts_at"
    FROM "ticket_sources" WHERE "product_id" = ${f.product} AND "workspace_id" = ${f.workspace}
    ORDER BY "id"`)
  return result.rows.map((row) => {
    const parsed = factsRow.parse(row)
    return {
      repo: parsed.repo,
      defaultBranch: parsed.default_branch,
      branchProtected: parsed.branch_protected,
      requiredChecksOnForge: parsed.required_check_names ?? [],
      hasAgentsFile: parsed.has_agents_file,
      issueForms: parsed.issue_form_count,
      readAt: parsed.facts_at?.toISOString() ?? null,
    }
  })
}

const mirrorCounts = async (payload: Payload, f: FirstLookFilter) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT count(*) FILTER (WHERE "kind" = 'issue') AS issues,
      count(*) FILTER (WHERE "kind" = 'issue' AND "state" = 'open') AS open_issues,
      count(*) FILTER (WHERE "kind" = 'issue' AND "state" = 'open' AND jsonb_array_length("assignees") > 0) AS assigned,
      count(*) FILTER (WHERE "kind" = 'issue' AND "state" = 'open'
        AND "forge_updated_at" < ${ago(f.now, 365)}::timestamptz) AS stale,
      count(*) FILTER (WHERE "kind" = 'pr') AS pulls,
      count(*) FILTER (WHERE "kind" = 'pr' AND "state" = 'open') AS open_pulls,
      count(*) FILTER (WHERE "kind" = 'pr' AND "state" = 'open' AND jsonb_array_length("closes") > 0) AS closing
    FROM "mirror_items"
    WHERE "workspace_id" = ${f.workspace} AND "product_id" = ${f.product} AND "gone_at" IS NULL`)
  return mirrorRow.parse(result.rows[0])
}

const recordCounts = async (payload: Payload, f: FirstLookFilter) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT count(*) FILTER (WHERE r."stage" = 'brief' OR (r."stage" = 'intake' AND r."waiting_on" = 'agents'
        AND NOT (r."data"->'source'->>'external')::boolean)) AS ready,
      count(*) FILTER (WHERE r."waiting_on" = 'reporter') AS needing,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "events" e WHERE e."record_id" = r."id"
        AND e."type" = 'intake.closed' AND e."data"->>'reason' = 'duplicate')) AS duplicates
    FROM "records" r WHERE r."workspace_id" = ${f.workspace} AND r."product_id" = ${f.product}`)
  return recordRow.parse(result.rows[0])
}

const sourceFacts = async (payload: Payload, f: FirstLookFilter) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT p."required_checks" AS required, count(s."id") AS sources, count(s."imported_at") AS imported
    FROM "products" p LEFT JOIN "ticket_sources" s ON s."product_id" = p."id"
    WHERE p."id" = ${f.product} AND p."workspace_id" = ${f.workspace} GROUP BY p."id"`)
  return sourceRow.parse(result.rows[0] ?? { required: null, sources: 0, imported: 0 })
}

export const firstLook = async (payload: Payload, filter: FirstLookFilter): Promise<FirstLook> => {
  const mirror = await mirrorCounts(payload, filter)
  const records = await recordCounts(payload, filter)
  const sources = await sourceFacts(payload, filter)
  const classified = await classifiedIn(payload, filter)
  const repositories = await repositoryFacts(payload, filter)
  const requiredChecks = (sources.required ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '')
  const picked = (action: string) => classified.filter(({ selection }) => selection.action === action).length
  return {
    issues: {
      open: mirror.open_issues,
      readyForBrief: records.ready + picked('enter'),
      needingInformation: records.needing,
      closedAsDuplicate: records.duplicates,
      withoutActivityForAYear: mirror.stale,
      heldForOutsideAuthor: picked('hold'),
      assignedToPerson: mirror.assigned,
    },
    pullRequests: {
      open: mirror.open_pulls,
      closingAnIssue: mirror.closing,
      notClosingAnIssue: mirror.open_pulls - mirror.closing,
    },
    repository: {
      requiredChecks,
      syncCompleted: sources.sources > 0 && sources.imported === sources.sources,
      issuesMirrored: mirror.issues,
      pullRequestsMirrored: mirror.pulls,
      suggestForgeChecks: requiredChecks.length === 0 && repositories.some((r) => r.requiredChecksOnForge.length > 0),
      repositories,
    },
  }
}
