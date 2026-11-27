import { budgetOf, ForgeRateLimited, isForgeOutage } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export const OUTAGE_PAUSE_MS = 2 * 60_000
export const LOW_BUDGET = 0.2
export const LOW_BUDGET_POLL_MS = 5 * 60_000

export type PauseReason = 'rate-limit' | 'outage'
export type Hold = { until: Date; reason: PauseReason; message: string }

const limitsSchema = z
  .object({
    limit: z.number(),
    remaining: z.number(),
    resetAt: z.string().nullable(),
    observedAt: z.string(),
    pausedUntil: z.string(),
    pauseReason: z.enum(['rate-limit', 'outage']),
  })
  .partial()

export type ForgeLimits = z.infer<typeof limitsSchema>

const rowSchema = z.object({ kind: z.string(), limits: limitsSchema.nullable() })
const idSchema = z.object({ id: z.coerce.number() })

const clock = (at: Date): string => `${at.toISOString().slice(11, 16)} UTC`

const forgeName = (kind: string): string => (kind === 'gitlab' ? 'GitLab' : 'GitHub')

const messageOf = (kind: string, reason: PauseReason, until: Date): string =>
  reason === 'rate-limit'
    ? `${forgeName(kind)} limit reached, resumes at ${clock(until)}`
    : `${forgeName(kind)} is not answering, retrying at ${clock(until)}`

export const readLimits = async (payload: Payload, connection: number): Promise<{ kind: string } & ForgeLimits> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "kind"::text AS kind, "forge_limits" AS limits FROM "connections" WHERE "id" = ${connection}`,
  )
  const row = found.rows[0] ? rowSchema.parse(found.rows[0]) : { kind: 'github', limits: null }
  return { kind: row.kind, ...row.limits }
}

export const holdOf = async (payload: Payload, connection: number, now: Date): Promise<Hold | null> => {
  const { kind, pausedUntil, pauseReason } = await readLimits(payload, connection)
  if (pausedUntil === undefined || pauseReason === undefined) return null
  const until = new Date(pausedUntil)
  return until > now ? { until, reason: pauseReason, message: messageOf(kind, pauseReason, until) } : null
}

const merge = (payload: Payload, connection: number, patch: ForgeLimits, touched: boolean) =>
  payload.db.drizzle.execute(sql`
    UPDATE "connections" SET "forge_limits" = coalesce("forge_limits", '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
      "updated_at" = CASE WHEN ${touched} THEN now() ELSE "updated_at" END
    WHERE "id" = ${connection}`)

export const saveBudget = async (payload: Payload, connection: number): Promise<void> => {
  const budget = budgetOf(String(connection))
  if (!budget) return
  await merge(payload, connection, {
    limit: budget.limit,
    remaining: budget.remaining,
    resetAt: budget.resetAt?.toISOString() ?? null,
    observedAt: budget.observedAt.toISOString(),
  }, false)
}

export const isLowBudget = (limits: ForgeLimits, now: Date): boolean =>
  limits.limit !== undefined &&
  limits.remaining !== undefined &&
  limits.limit > 0 &&
  limits.remaining / limits.limit < LOW_BUDGET &&
  (limits.resetAt == null || new Date(limits.resetAt) > now)

const hold = async (payload: Payload, connection: number, until: Date, reason: PauseReason, now: Date) => {
  const current = await holdOf(payload, connection, now)
  if (current && current.until >= until) return current
  await merge(payload, connection, { pausedUntil: until.toISOString(), pauseReason: reason }, true)
  return holdOf(payload, connection, now)
}

export const holdForError = async (
  payload: Payload,
  connection: number,
  error: unknown,
  now: Date,
): Promise<Hold | null> => {
  if (error instanceof ForgeRateLimited) return hold(payload, connection, error.resetAt, 'rate-limit', now)
  if (isForgeOutage(error)) return hold(payload, connection, new Date(now.getTime() + OUTAGE_PAUSE_MS), 'outage', now)
  return null
}

export const connectionOfRecord = async (payload: Payload, recordId: number): Promise<number | null> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."connection_id" AS id FROM "records" r
    JOIN "ticket_sources" s ON s."product_id" = r."product_id" WHERE r."id" = ${recordId} LIMIT 1`)
  return found.rows[0] ? idSchema.parse(found.rows[0]).id : null
}

export const holdOfRecord = async (payload: Payload, recordId: number, now: Date): Promise<Hold | null> => {
  const connection = await connectionOfRecord(payload, recordId)
  return connection === null ? null : holdOf(payload, connection, now)
}

export const holdForRecordError = async (
  payload: Payload,
  recordId: number,
  error: unknown,
  now: Date,
): Promise<Hold | null> => {
  if (!(error instanceof ForgeRateLimited) && !isForgeOutage(error)) return null
  const connection = await connectionOfRecord(payload, recordId)
  return connection === null ? null : holdForError(payload, connection, error, now)
}

export const activeHolds = async (payload: Payload, workspace: number, now: Date): Promise<Hold[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "id" FROM "connections" WHERE "workspace_id" = ${workspace}
      AND ("forge_limits"->>'pausedUntil')::timestamptz > ${now.toISOString()}::timestamptz ORDER BY "id"`)
  const holds = await Promise.all(found.rows.map((row) => holdOf(payload, idSchema.parse(row).id, now)))
  return holds.filter((h): h is Hold => h !== null)
}

export const pollWaits = async (
  payload: Payload,
  source: { id: number; connection: number },
  now: Date,
): Promise<boolean> => {
  if (await holdOf(payload, source.connection, now)) return true
  if (!isLowBudget(await readLimits(payload, source.connection), now)) return false
  const found = await payload.db.drizzle.execute(
    sql`SELECT "last_polled_at" AS polled FROM "ticket_sources" WHERE "id" = ${source.id}`,
  )
  const polled = z.object({ polled: z.coerce.date().nullable() }).parse(found.rows[0] ?? { polled: null }).polled
  return polled !== null && now.getTime() - polled.getTime() < LOW_BUDGET_POLL_MS
}
