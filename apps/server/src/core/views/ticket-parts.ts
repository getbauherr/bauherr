import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stageSchema, type Stage } from '../events'
import { ROLES, type RunStep } from '../run/schema'

const count = z.coerce.number()

const runRow = z.object({
  id: count,
  stage: stageSchema,
  role: z.enum(ROLES),
  status: z.string(),
  leased_by: z.string().nullable(),
  steps: z.array(z.object({ at: z.string(), text: z.string() })),
  error: z.string().nullable(),
  started_at: z.coerce.date().nullable(),
  finished_at: z.coerce.date().nullable(),
})

export type RunView = {
  id: number
  stage: Stage
  role: string
  status: string
  leasedBy: string | null
  steps: RunStep[]
  error: string | null
  startedAt: string | null
  finishedAt: string | null
}

export const loadRuns = async (payload: Payload, recordId: number): Promise<RunView[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "stage", "role", "status", "leased_by", "steps", "error", "started_at", "finished_at"
    FROM "stage_runs" WHERE "record_id" = ${recordId} ORDER BY "id"`)
  return result.rows.map((row) => {
    const r = runRow.parse(row)
    return {
      id: r.id,
      stage: r.stage,
      role: r.role,
      status: r.status,
      leasedBy: r.leased_by,
      steps: r.steps,
      error: r.error,
      startedAt: r.started_at?.toISOString() ?? null,
      finishedAt: r.finished_at?.toISOString() ?? null,
    }
  })
}

const proofRow = z.object({
  id: count,
  criterion: z.string(),
  kind: z.string(),
  source: z.string(),
  sha: z.string(),
  body: z.string().nullable(),
  url: z.string().nullable(),
})

export type ProofView = {
  id: number
  kind: string
  source: string
  sha: string
  body: string | null
  url: string | null
}
export type ProofGroup = { criterion: string; proofs: ProofView[] }

export const loadProofs = async (payload: Payload, recordId: number): Promise<ProofGroup[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "criterion", "kind", "source", "sha", "body", "url" FROM "proofs"
    WHERE "record_id" = ${recordId} ORDER BY "criterion", "id"`)
  const groups = new Map<string, ProofView[]>()
  for (const row of result.rows) {
    const { criterion, ...proof } = proofRow.parse(row)
    groups.set(criterion, [...(groups.get(criterion) ?? []), proof])
  }
  return [...groups].map(([criterion, proofs]) => ({ criterion, proofs }))
}

const itemRow = z.object({
  id: count,
  title: z.string(),
  body: z.string().nullable(),
  url: z.string().nullable(),
  state: z.enum(['open', 'closed', 'merged']),
  head_sha: z.string().nullable(),
})

export type MirrorItem = { id: number; title: string; body: string; url: string; state: string; headSha: string }

export const loadItem = async (
  payload: Payload,
  where: { workspace: number; repo: string; number: number },
): Promise<MirrorItem | null> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "title", "body", "url", "state", "head_sha" FROM "mirror_items"
    WHERE "workspace_id" = ${where.workspace} AND "repo" = ${where.repo} AND "number" = ${where.number}`)
  const raw = result.rows[0]
  if (!raw) return null
  const row = itemRow.parse(raw)
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? '',
    url: row.url ?? '',
    state: row.state,
    headSha: row.head_sha ?? '',
  }
}

const checkRow = z.object({
  name: z.string(),
  status: z.string().nullable(),
  conclusion: z.string().nullable(),
  url: z.string().nullable(),
})

export type CheckView = { name: string; status: string; conclusion: string | null; url: string }

export const loadChecks = async (payload: Payload, item: MirrorItem): Promise<CheckView[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "name", "status", "conclusion", "url" FROM "mirror_checks"
    WHERE "item_id" = ${item.id} AND "sha" = ${item.headSha} ORDER BY "name"`)
  return result.rows.map((row) => {
    const c = checkRow.parse(row)
    return { name: c.name, status: c.status ?? '', conclusion: c.conclusion, url: c.url ?? '' }
  })
}
