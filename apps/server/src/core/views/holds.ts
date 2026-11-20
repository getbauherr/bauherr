import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { stageSchema, type Stage } from '../events'
import { loadRows } from './rows'
import { isStuck } from './status'

export const AGENT_SILENCE_MS = 10 * 60_000

export type Hold =
  | { kind: 'product-observing'; product: number; name: string; waiting: number }
  | { kind: 'no-agent-connected'; stage: Stage; role: string; queued: number }
  | { kind: 'ticket-stuck'; recordId: number; repo: string; number: number; title: string; reason: string }
  | { kind: 'sync-failed'; repo: string; error: string; at: string | null }

export type HoldFilter = { workspace: number; now: Date }

const count = z.coerce.number()
const observingRow = z.object({ id: count, name: z.string(), waiting: count })
const silentRow = z.object({ stage: stageSchema, role: z.string(), queued: count })
const failedRow = z.object({ repo: z.string(), error: z.string(), at: z.coerce.date().nullable() })

const observing = async (payload: Payload, { workspace }: HoldFilter): Promise<Hold[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT p."id", p."name", count(r."id") AS waiting FROM "products" p
    JOIN "records" r ON r."product_id" = p."id" AND r."workspace_id" = p."workspace_id"
      AND (r."waiting_on" <> 'nobody' OR r."parked" IS NOT NULL)
    WHERE p."workspace_id" = ${workspace} AND p."state" = 'observing'
    GROUP BY p."id", p."name" ORDER BY p."id"`)
  return result.rows.map((row) => {
    const parsed = observingRow.parse(row)
    return { kind: 'product-observing', product: parsed.id, name: parsed.name, waiting: parsed.waiting }
  })
}

const unattended = async (payload: Payload, { workspace, now }: HoldFilter): Promise<Hold[]> => {
  const since = new Date(now.getTime() - AGENT_SILENCE_MS).toISOString()
  const result = await payload.db.drizzle.execute(sql`
    SELECT s."stage", s."role", count(*) AS queued FROM "stage_runs" s
    WHERE s."workspace_id" = ${workspace} AND s."status" = 'queued' AND NOT EXISTS (
      SELECT 1 FROM "agent_sessions" a WHERE a."workspace_id" = s."workspace_id" AND a."role" = s."role"
        AND a."disconnected_at" IS NULL AND a."last_seen_at" >= ${since}::timestamptz)
    GROUP BY s."stage", s."role" ORDER BY s."stage", s."role"`)
  return result.rows.map((row) => {
    const parsed = silentRow.parse(row)
    return { kind: 'no-agent-connected', stage: parsed.stage, role: parsed.role, queued: parsed.queued }
  })
}

const stuck = async (payload: Payload, filter: HoldFilter): Promise<Hold[]> =>
  (await loadRows(payload, filter))
    .filter((row) => row.parked === null && isStuck(row.card))
    .map((row) => ({
      kind: 'ticket-stuck',
      recordId: row.recordId,
      repo: row.repo,
      number: row.number,
      title: row.title,
      reason: row.card?.reason ?? '',
    }))

const failedSyncs = async (payload: Payload, { workspace }: HoldFilter): Promise<Hold[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "repo", "last_error" AS error, "last_polled_at" AS at FROM "ticket_sources"
    WHERE "workspace_id" = ${workspace} AND "last_error" IS NOT NULL ORDER BY "id"`)
  return result.rows.map((row) => {
    const parsed = failedRow.parse(row)
    return { kind: 'sync-failed', repo: parsed.repo, error: parsed.error, at: parsed.at?.toISOString() ?? null }
  })
}

export const holds = async (payload: Payload, filter: HoldFilter): Promise<Hold[]> => [
  ...(await observing(payload, filter)),
  ...(await unattended(payload, filter)),
  ...(await stuck(payload, filter)),
  ...(await failedSyncs(payload, filter)),
]
