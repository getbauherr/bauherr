import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import type { RepositoryFacts, ReadinessFacts } from './checks'
import { releaseFactsSchema } from './release-facts'
import { loadNotStarted, recentPulls } from './not-started'
import { riskSuggestionsSchema, SUGGESTIONS_KEY } from './suggest'

export type FactsFilter = { workspace: number; product: number; now: Date }
export type Loaded = { facts: ReadinessFacts; checkedAt: string | null; repo: string | null }

const DAY_MS = 86_400_000

const namesIn = (text: string): string[] => [
  ...new Set(text.split(',').map((name) => name.trim()).filter((name) => name !== '')),
]

const productRow = z.object({
  required_checks: z.string().nullable().transform((value) => namesIn(value ?? '')),
  risk_areas: z.array(z.string()).nullable().transform((value) => value ?? []),
  executor: z
    .string()
    .nullable()
    .transform((value) => (value === 'runner' ? ('runner' as const) : ('session' as const))),
  release_mode: z
    .string()
    .nullable()
    .transform((value) => (value === 'direct' ? ('direct' as const) : ('factory' as const))),
})
const sourceRow = z.object({
  repo: z.string(),
  branch_protected: z.enum(['yes', 'no', 'unknown']).nullable(),
  has_agents_file: z.boolean().nullable(),
  agents_file: z.string().nullable(),
  issue_form_count: z.coerce.number().nullable(),
  facts_at: z.coerce.date().nullable(),
  risk_suggestions: riskSuggestionsSchema.nullable(),
  release_facts: releaseFactsSchema.nullable(),
})
const roleRow = z.object({ role: z.string() })

const repositoryOf = (row: z.output<typeof sourceRow>): RepositoryFacts | null =>
  row.facts_at === null || row.has_agents_file === null
    ? null
    : {
        branchProtected: row.branch_protected ?? 'unknown',
        hasAgentsFile: row.has_agents_file,
        agentsFile: row.agents_file,
        issueFormCount: row.issue_form_count ?? 0,
        riskSuggestions: row.risk_suggestions,
      }

const rolesSeen = async (payload: Payload, f: FactsFilter): Promise<string[]> => {
  const since = new Date(f.now.getTime() - DAY_MS).toISOString()
  const found = await payload.db.drizzle.execute(sql`
    SELECT DISTINCT "role" FROM "agent_sessions"
    WHERE "workspace_id" = ${f.workspace} AND "last_seen_at" >= ${since}::timestamptz`)
  return found.rows.map((row) => roleRow.parse(row).role)
}

const productOf = async (payload: Payload, f: FactsFilter) => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "required_checks", "risk_areas", "executor", "release_mode" FROM "products"
    WHERE "id" = ${f.product} AND "workspace_id" = ${f.workspace}`)
  return found.rows[0] ? productRow.parse(found.rows[0]) : null
}

const sourceOf = async (payload: Payload, f: FactsFilter) => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."repo", s."branch_protected", s."has_agents_file", s."agents_file", s."issue_form_count", s."facts_at",
      s."release_facts",
      (SELECT st."value" FROM "instance_state" st WHERE st."key" = ${SUGGESTIONS_KEY} || s."id"::text)
        AS risk_suggestions
    FROM "ticket_sources" s
    WHERE s."product_id" = ${f.product} AND s."workspace_id" = ${f.workspace} ORDER BY s."id" LIMIT 1`)
  return found.rows[0] ? sourceRow.parse(found.rows[0]) : null
}

const sourceFacts = (source: Awaited<ReturnType<typeof sourceOf>>) => ({
  checkedAt: source?.facts_at?.toISOString() ?? null,
  repo: source?.repo ?? null,
  repository: source ? repositoryOf(source) : null,
  release: source?.release_facts ?? null,
})

export const loadFacts = async (payload: Payload, f: FactsFilter): Promise<Loaded | null> => {
  const product = await productOf(payload, f)
  if (!product) return null
  const source = await sourceOf(payload, f)
  const waiting = await loadNotStarted(payload, f)
  const { checkedAt, repo, repository, release } = sourceFacts(source)
  return {
    checkedAt,
    repo,
    facts: {
      requiredChecks: product.required_checks,
      riskAreas: product.risk_areas,
      pulls: await recentPulls(payload, f.product),
      repository,
      executor: product.executor,
      rolesSeen: await rolesSeen(payload, f),
      releaseMode: product.release_mode,
      release,
      waiting: waiting.map(({ recordId, number, waitedMinutes }) => ({ recordId, number, waitedMinutes })),
    },
  }
}
