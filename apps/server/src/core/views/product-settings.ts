import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export type SourceState = {
  id: number
  repo: string
  connection: string | null
  importedAt: string | null
  lastPolledAt: string | null
  lastError: string | null
  issuesMirrored: number
  pullRequestsMirrored: number
}

export type ProductSettings = {
  id: number
  name: string
  slug: string
  state: 'observing' | 'active'
  executor: 'session' | 'runner'
  releaseMode: 'factory' | 'direct'
  riskAreas: string[]
  pathSets: Record<string, string[]>
  requiredChecks: string
  deployChecks: string
  deployWaitMinutes: number
  stagingUrl: string
  autoClose: boolean
  excludedLabels: string[]
  outsideIssuesPerDay: number
  reporterRemindDays: number
  reporterSilentDays: number
  backlogBriefLimit: number
  autoAccept: boolean
  autoAcceptMaxSendBack: number
  repositories: { id: number; fullName: string }[]
  sources: SourceState[]
}

export type ProductFilter = { workspace: number; product: number }

const count = z.coerce.number()
const instant = z.coerce.date().nullable().transform((date) => date?.toISOString() ?? null)

const text = z.string().nullable().transform((value) => value ?? '')
const list = z.array(z.string()).nullable().transform((value) => value ?? [])
const flag = (fallback: boolean) => z.boolean().nullable().transform((value) => value ?? fallback)
const amount = (fallback: number) => count.nullable().transform((value) => value ?? fallback)

const productRow = z.object({
  id: count,
  name: z.string(),
  slug: z.string(),
  state: z.string().nullable(),
  executor: z.string().nullable(),
  release_mode: z.string().nullable(),
  risk_areas: list,
  path_sets: z.record(z.string(), z.array(z.string())).nullable().transform((value) => value ?? {}),
  required_checks: text,
  deploy_checks: text,
  deploy_wait_minutes: amount(60),
  staging_url: text,
  auto_close: flag(true),
  intake_excluded_labels: list,
  outside_issues_per_day: amount(5),
  reporter_remind_days: amount(7),
  reporter_silent_days: amount(21),
  backlog_brief_limit: amount(5),
  auto_accept: flag(false),
  auto_accept_max_send_back: amount(10),
})

const sourceRow = z.object({
  id: count,
  repo: z.string(),
  connection: z.string().nullable(),
  imported_at: instant,
  last_polled_at: instant,
  last_error: z.string().nullable(),
  issues: count,
  pulls: count,
})

const repositoryRow = z.object({ id: count, full_name: z.string() })

const sourcesOf = async (payload: Payload, f: ProductFilter): Promise<SourceState[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT s."id", s."repo", c."name" AS connection, s."imported_at", s."last_polled_at", s."last_error",
      count(m."id") FILTER (WHERE m."kind" = 'issue') AS issues,
      count(m."id") FILTER (WHERE m."kind" = 'pr') AS pulls
    FROM "ticket_sources" s
    LEFT JOIN "connections" c ON c."id" = s."connection_id"
    LEFT JOIN "mirror_items" m ON m."source_id" = s."id" AND m."gone_at" IS NULL
    WHERE s."product_id" = ${f.product} AND s."workspace_id" = ${f.workspace}
    GROUP BY s."id", c."name" ORDER BY s."id"`)
  return result.rows.map((row) => {
    const parsed = sourceRow.parse(row)
    return {
      id: parsed.id,
      repo: parsed.repo,
      connection: parsed.connection,
      importedAt: parsed.imported_at,
      lastPolledAt: parsed.last_polled_at,
      lastError: parsed.last_error,
      issuesMirrored: parsed.issues,
      pullRequestsMirrored: parsed.pulls,
    }
  })
}

const repositoriesOf = async (payload: Payload, f: ProductFilter) => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "full_name" FROM "repositories"
    WHERE "product_id" = ${f.product} AND "workspace_id" = ${f.workspace} ORDER BY "id"`)
  return result.rows.map((row) => {
    const parsed = repositoryRow.parse(row)
    return { id: parsed.id, fullName: parsed.full_name }
  })
}

const settingsOf = (row: z.output<typeof productRow>) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  state: row.state === 'active' ? ('active' as const) : ('observing' as const),
  executor: row.executor === 'runner' ? ('runner' as const) : ('session' as const),
  releaseMode: row.release_mode === 'direct' ? ('direct' as const) : ('factory' as const),
  riskAreas: row.risk_areas,
  pathSets: row.path_sets,
  requiredChecks: row.required_checks,
  deployChecks: row.deploy_checks,
  deployWaitMinutes: row.deploy_wait_minutes,
  stagingUrl: row.staging_url,
  autoClose: row.auto_close,
  excludedLabels: row.intake_excluded_labels,
  outsideIssuesPerDay: row.outside_issues_per_day,
  reporterRemindDays: row.reporter_remind_days,
  reporterSilentDays: row.reporter_silent_days,
  backlogBriefLimit: row.backlog_brief_limit,
  autoAccept: row.auto_accept,
  autoAcceptMaxSendBack: row.auto_accept_max_send_back,
})

export const productSettings = async (payload: Payload, f: ProductFilter): Promise<ProductSettings | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "name", "slug", "state", "executor", "release_mode", "risk_areas", "path_sets",
      "required_checks", "deploy_checks", "deploy_wait_minutes", "staging_url", "auto_close", "intake_excluded_labels",
      "outside_issues_per_day", "reporter_remind_days", "reporter_silent_days", "backlog_brief_limit", "auto_accept",
      "auto_accept_max_send_back"
    FROM "products" WHERE "id" = ${f.product} AND "workspace_id" = ${f.workspace}`)
  if (!result.rows[0]) return null
  return {
    ...settingsOf(productRow.parse(result.rows[0])),
    repositories: await repositoriesOf(payload, f),
    sources: await sourcesOf(payload, f),
  }
}

const checkNamesRow = z.object({ names: z.array(z.string()).nullable() })

export const forgeCheckNames = async (payload: Payload, f: ProductFilter): Promise<string[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "required_check_names" AS names FROM "ticket_sources"
    WHERE "product_id" = ${f.product} AND "workspace_id" = ${f.workspace} ORDER BY "id"`)
  const names = result.rows.flatMap((row) => checkNamesRow.parse(row).names ?? [])
  return [...new Set(names)].sort()
}
