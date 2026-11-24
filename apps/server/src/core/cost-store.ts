import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { attribute, outsideRuns, type CostRun, type GatewayRequest, type Measured } from './cost'

export const MEASURE_DELAY_MS = 5 * 60_000
export const REMEASURE_MS = 60 * 60_000
export const MEASURE_WINDOW_MS = 24 * 60 * 60_000
const DAY_MS = 86_400_000
const BACKFILL_DAYS = 90
const OUTSIDE_RECENT_DAYS = 2
const RUNNER_LEASE = 'runner-%'

export type RequestQuery = { user: string; sessions: string[]; runs: string[]; from: Date; to: Date }
export type ReadRequests = (query: RequestQuery) => Promise<GatewayRequest[]>

const id = z.coerce.number()
const runRow = z.object({
  id,
  workspace_id: id,
  slug: z.string(),
  client_session: z.string().nullable(),
  runner: z.boolean(),
  started_at: z.coerce.date(),
  finished_at: z.coerce.date(),
})
type Row = z.infer<typeof runRow>

const toRun = (row: Row): CostRun => ({
  id: row.id,
  link: row.client_session === null ? { kind: 'run' } : { kind: 'session', session: row.client_session },
  claimedAt: row.started_at,
  endedAt: row.finished_at,
})

const userOf = (slug: string): string => `workspace-${slug}`

const dueRuns = async (payload: Payload, now: Date): Promise<Row[]> => {
  const settled = new Date(now.getTime() - MEASURE_DELAY_MS).toISOString()
  const again = new Date(now.getTime() - REMEASURE_MS).toISOString()
  const recent = new Date(now.getTime() - MEASURE_WINDOW_MS).toISOString()
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."id", s."workspace_id", w."slug", s."client_session", (s."leased_by" LIKE ${RUNNER_LEASE}) AS runner,
      s."started_at", s."finished_at"
    FROM "stage_runs" s JOIN "workspaces" w ON w."id" = s."workspace_id"
    WHERE s."started_at" IS NOT NULL AND s."finished_at" IS NOT NULL AND s."finished_at" <= ${settled}::timestamptz
      AND s."finished_at" >= ${recent}::timestamptz
      AND (s."client_session" IS NOT NULL OR s."leased_by" LIKE ${RUNNER_LEASE})
      AND (s."cost_measured_at" IS NULL OR s."cost_measured_at" <= ${again}::timestamptz)
    ORDER BY s."id"`)
  return found.rows.map((row) => runRow.parse(row))
}

const sessionRuns = async (payload: Payload, workspace: number, sessions: string[]): Promise<CostRun[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."id", s."workspace_id", w."slug", s."client_session", false AS runner, s."started_at",
      coalesce(s."finished_at", now()) AS finished_at
    FROM "stage_runs" s JOIN "workspaces" w ON w."id" = s."workspace_id"
    WHERE s."workspace_id" = ${workspace} AND s."started_at" IS NOT NULL
      AND s."client_session" IN (${sql.join(sessions.map((s) => sql`${s}`), sql`, `)})`)
  return found.rows.map((row) => toRun(runRow.parse(row)))
}

const write = async (payload: Payload, run: Row, measured: Measured | undefined, now: Date): Promise<void> => {
  const cost = measured?.costUsd ?? null
  await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "cost_measured_at" = ${now.toISOString()},
      "cost_usd" = coalesce(${cost}::numeric, "cost_usd"), "cost_source" = ${cost === null ? null : 'gateway'},
      "input_tokens" = ${measured?.inputTokens ?? null}, "output_tokens" = ${measured?.outputTokens ?? null},
      "updated_at" = now()
    WHERE "id" = ${run.id}`)
}

const measureWorkspace = async (payload: Payload, read: ReadRequests, due: Row[], now: Date): Promise<void> => {
  const first = due[0]
  if (!first) return
  const sessions = [...new Set(due.flatMap((run) => (run.client_session === null ? [] : [run.client_session])))]
  const from = new Date(Math.min(...due.map((run) => run.started_at.getTime())))
  const to = new Date(Math.max(...due.map((run) => run.finished_at.getTime())))
  const requests = await read({
    user: userOf(first.slug),
    sessions,
    runs: due.filter((run) => run.runner).map((run) => String(run.id)),
    from,
    to,
  })
  const known = sessions.length === 0 ? [] : await sessionRuns(payload, first.workspace_id, sessions)
  const runner = due.filter((run) => run.client_session === null).map(toRun)
  const measured = attribute([...known, ...runner], requests)
  for (const run of due) await write(payload, run, measured.get(run.id), now)
}

export const measureRuns = async (payload: Payload, read: ReadRequests, now: Date): Promise<number> => {
  const due = await dueRuns(payload, now)
  for (const workspace of new Set(due.map((run) => run.workspace_id))) {
    await measureWorkspace(payload, read, due.filter((run) => run.workspace_id === workspace), now)
  }
  return due.length
}

export type OutsideCost = { days: Record<string, number>; measuredAt: string }
const outsideSchema = z.object({ days: z.record(z.string(), z.number()), measuredAt: z.string() })
const stateKey = (workspace: number): string => `cost-outside:${workspace}`

export const outsideCost = async (payload: Payload, workspace: number): Promise<OutsideCost | null> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "value" FROM "instance_state" WHERE "key" = ${stateKey(workspace)}`,
  )
  const row = found.rows[0]
  return row ? outsideSchema.parse(row.value) : null
}

const dayStart = (time: number): number => time - (time % DAY_MS)

const sessionsOf = async (payload: Payload, workspace: number): Promise<string[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT "client_session" AS s FROM "agent_sessions" WHERE "workspace_id" = ${workspace}
      AND "client_session" IS NOT NULL
    UNION SELECT "client_session" FROM "stage_runs" WHERE "workspace_id" = ${workspace}
      AND "client_session" IS NOT NULL`)
  return found.rows.map((row) => z.string().parse(Object.values(row)[0]))
}

const measureOutside = async (
  payload: Payload,
  read: ReadRequests,
  workspace: { id: number; slug: string },
  now: Date,
): Promise<void> => {
  const previous = await outsideCost(payload, workspace.id)
  if (previous && now.getTime() - Date.parse(previous.measuredAt) < REMEASURE_MS) return
  const sessions = await sessionsOf(payload, workspace.id)
  const span = (previous ? OUTSIDE_RECENT_DAYS : BACKFILL_DAYS) * DAY_MS
  const from = new Date(dayStart(now.getTime() - span))
  const query = { user: userOf(workspace.slug), sessions, runs: [], from, to: now }
  const requests = sessions.length === 0 ? [] : await read(query)
  const runs = sessions.length === 0 ? [] : await sessionRuns(payload, workspace.id, sessions)
  const fromKey = from.toISOString().slice(0, 10)
  const kept = Object.entries(previous?.days ?? {}).filter(([day]) => day < fromKey)
  const recomputed = [...outsideRuns(runs, requests)]
  const value: OutsideCost = { days: Object.fromEntries([...kept, ...recomputed]), measuredAt: now.toISOString() }
  await payload.db.drizzle.execute(sql`
    INSERT INTO "instance_state" ("key", "value") VALUES (${stateKey(workspace.id)}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`)
}

export const measureOutsideRuns = async (payload: Payload, read: ReadRequests, now: Date): Promise<void> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT w."id", w."slug" FROM "workspaces" w WHERE EXISTS (
      SELECT 1 FROM "agent_sessions" a WHERE a."workspace_id" = w."id" AND a."client_session" IS NOT NULL)`)
  for (const row of found.rows) {
    await measureOutside(payload, read, z.object({ id, slug: z.string() }).parse(row), now)
  }
}
