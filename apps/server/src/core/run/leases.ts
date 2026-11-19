import { createHash, randomBytes } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import type { Conn } from '../conn'
import type { Stage } from '../events'
import type { Role } from '../lifecycle'
import { RecordNotFound } from '../record/errors'
import { RunConflict, RunNotClaimed, WrongLeaseToken } from './errors'
import { MAX_STEPS, toRun, type Run } from './schema'
import { readRun, RUN_COLUMNS } from './store'

export const LEASE_MS = 30 * 60_000

export type NewRun = { stage: Stage; role: Role; fingerprint: string }
export type ClaimInput = { workspace: number; role: Role; by: string; now: Date }
export type Claimed = { run: Run; token: string }
export type Expired = { runId: number; recordId: number; stage: Stage }

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex')
const leaseEnd = (now: Date): string => new Date(now.getTime() + LEASE_MS).toISOString()

export const enqueue = async (
  payload: Conn,
  recordId: number,
  input: NewRun,
): Promise<{ run: Run; created: boolean }> => {
  const db = payload.db.drizzle
  const inserted = await db.execute(sql`
    INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role", "status", "fingerprint", "attempt",
      "steps", "updated_at", "created_at")
    SELECT "workspace_id", "id", ${input.stage}, ${input.role}, 'queued', ${input.fingerprint}, 0,
      '[]'::jsonb, now(), now()
    FROM "records" WHERE "id" = ${recordId}
    ON CONFLICT ("record_id") WHERE "status" IN ('queued', 'claimed') DO NOTHING
    RETURNING ${RUN_COLUMNS}`)
  const created = inserted.rows[0]
  if (created) return { run: toRun(created), created: true }
  const live = await db.execute(
    sql`SELECT ${RUN_COLUMNS} FROM "stage_runs" WHERE "record_id" = ${recordId} AND "status" IN ('queued', 'claimed')`,
  )
  const row = live.rows[0]
  if (!row) throw new RecordNotFound(`Record ${recordId} does not exist: check the id.`)
  const existing = toRun(row)
  if (existing.stage !== input.stage || existing.fingerprint !== input.fingerprint) {
    throw new RunConflict(`Record ${recordId} has a live run for another stage or version: release it first.`)
  }
  return { run: existing, created: false }
}

export const claim = async (payload: Conn, input: ClaimInput): Promise<Claimed | null> => {
  const token = randomBytes(32).toString('hex')
  const updated = await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "status" = 'claimed', "leased_by" = ${input.by}, "lease_token_hash" = ${hashOf(token)},
      "lease_expires_at" = ${leaseEnd(input.now)}, "started_at" = ${input.now.toISOString()}, "updated_at" = now()
    WHERE "id" = (
      SELECT s."id" FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id"
      WHERE s."status" = 'queued' AND s."role" = ${input.role} AND s."workspace_id" = ${input.workspace}
      ORDER BY r."rank", s."created_at", s."id" LIMIT 1 FOR UPDATE OF s SKIP LOCKED
    ) AND "status" = 'queued'
    RETURNING ${RUN_COLUMNS}`)
  const row = updated.rows[0]
  return row ? { run: toRun(row), token } : null
}

const refusal = async (payload: Conn, runId: number): Promise<never> => {
  const run = await readRun(payload, runId)
  if (run.status !== 'claimed') {
    throw new RunNotClaimed(`Run ${runId} is ${run.status}, not claimed: stop working on it.`)
  }
  throw new WrongLeaseToken(`The lease token does not belong to run ${runId}: use the token next_work returned.`)
}

export const authorize = async (payload: Conn, runId: number, token: string): Promise<Run> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT ${RUN_COLUMNS} FROM "stage_runs"
    WHERE "id" = ${runId} AND "status" = 'claimed' AND "lease_token_hash" = ${hashOf(token)}`)
  const row = found.rows[0]
  return row ? toRun(row) : refusal(payload, runId)
}

export const heartbeat = async (
  payload: Conn,
  runId: number,
  token: string,
  options: { now: Date; step?: string },
): Promise<Run> => {
  const added = JSON.stringify(options.step ? [{ at: options.now.toISOString(), text: options.step }] : [])
  const updated = await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "lease_expires_at" = ${leaseEnd(options.now)}, "updated_at" = now(),
      "steps" = (
        SELECT coalesce(jsonb_agg(t."e" ORDER BY t."n"), '[]'::jsonb) FROM (
          SELECT e."e", e."n" FROM jsonb_array_elements("steps" || ${added}::jsonb) WITH ORDINALITY AS e("e", "n")
          ORDER BY e."n" DESC LIMIT ${MAX_STEPS}
        ) t
      )
    WHERE "id" = ${runId} AND "status" = 'claimed' AND "lease_token_hash" = ${hashOf(token)}
    RETURNING ${RUN_COLUMNS}`)
  const row = updated.rows[0]
  return row ? toRun(row) : refusal(payload, runId)
}

export const release = async (payload: Conn, runId: number, token: string, now: Date): Promise<Run> => {
  const updated = await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "status" = 'released', "finished_at" = ${now.toISOString()}, "updated_at" = now()
    WHERE "id" = ${runId} AND "status" = 'claimed' AND "lease_token_hash" = ${hashOf(token)}
    RETURNING ${RUN_COLUMNS}`)
  const row = updated.rows[0]
  return row ? toRun(row) : refusal(payload, runId)
}

export const expire = async (payload: Conn, now: Date): Promise<Expired[]> => {
  const updated = await payload.db.drizzle.execute(sql`
    UPDATE "stage_runs" SET "status" = 'released', "finished_at" = ${now.toISOString()}, "updated_at" = now()
    WHERE "status" = 'claimed' AND "lease_expires_at" < ${now.toISOString()}
    RETURNING ${RUN_COLUMNS}`)
  return updated.rows.map((row) => {
    const run = toRun(row)
    return { runId: run.id, recordId: run.recordId, stage: run.stage }
  })
}
