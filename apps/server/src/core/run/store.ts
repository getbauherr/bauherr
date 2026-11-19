import { sql } from '@payloadcms/db-postgres'
import type { Conn } from '../conn'
import { RunNotClaimed, RunNotFound } from './errors'
import { toRun, type Run } from './schema'

export const RUN_COLUMNS = sql.raw(
  '"id", "record_id", "stage", "role", "status", "fingerprint", "attempt", "leased_by", ' +
    '"lease_expires_at", "steps", "result", "error", "cost_usd"',
)

export const readRun = async (payload: Conn, id: number): Promise<Run> => {
  const result = await payload.db.drizzle.execute(sql`SELECT ${RUN_COLUMNS} FROM "stage_runs" WHERE "id" = ${id}`)
  const row = result.rows[0]
  if (!row) throw new RunNotFound(`Run ${id} does not exist: check the id.`)
  return toRun(row)
}

export type Finish = { status: 'submitted' | 'failed'; result?: unknown; error?: string; now: Date }

export const finishRun = async (payload: Conn, id: number, finish: Finish): Promise<void> => {
  const updated = await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "status" = ${finish.status}, "result" = ${JSON.stringify(finish.result ?? null)}::jsonb,
      "error" = ${finish.error ?? null}, "finished_at" = ${finish.now.toISOString()}, "updated_at" = now()
    WHERE "id" = ${id} AND "status" = 'claimed' RETURNING "id"`)
  if (!updated.rows[0]) throw new RunNotClaimed(`Run ${id} is no longer claimed: it was released or finished.`)
}

export const markRefused = async (payload: Conn, id: number): Promise<void> => {
  const updated = await payload.db.drizzle.execute(
    sql`UPDATE "stage_runs" SET "attempt" = 1, "updated_at" = now()
      WHERE "id" = ${id} AND "status" = 'claimed' RETURNING "id"`,
  )
  if (!updated.rows[0]) throw new RunNotClaimed(`Run ${id} is no longer claimed: it was released or finished.`)
}
