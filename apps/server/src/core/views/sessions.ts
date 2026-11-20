import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export const IDLE_WINDOW_MS = 2 * 60_000
const LIMIT = 20

export type SessionState = 'working' | 'idle' | 'silent' | 'closed'

export type SessionRow = {
  id: number
  role: string
  label: string | null
  keyLabel: string
  connectedAt: string
  lastSeenAt: string
  state: SessionState
  ticket: { recordId: number; number: number } | null
}

export type SessionFilter = { workspace: number; owner: number; now: Date }

const row = z.object({
  id: z.coerce.number(),
  role: z.string(),
  label: z.string().nullable(),
  key_label: z.string().nullable(),
  connected_at: z.coerce.date(),
  last_seen_at: z.coerce.date(),
  closed: z.boolean(),
  record_id: z.coerce.number().nullable(),
  source_number: z.coerce.number().nullable(),
  seen_recently: z.boolean(),
})

const stateOf = (parsed: z.infer<typeof row>): SessionState => {
  if (parsed.closed) return 'closed'
  if (parsed.record_id !== null) return 'working'
  return parsed.seen_recently ? 'idle' : 'silent'
}

export const agentSessions = async (
  payload: Payload,
  { workspace, owner, now }: SessionFilter,
): Promise<SessionRow[]> => {
  const at = now.toISOString()
  const recently = new Date(now.getTime() - IDLE_WINDOW_MS).toISOString()
  const result = await payload.db.drizzle.execute(sql`
    SELECT a."id", a."role", a."label", k."label" AS key_label, a."connected_at", a."last_seen_at",
      a."disconnected_at" IS NOT NULL AS closed, live."record_id", live."source_number",
      a."last_seen_at" >= ${recently}::timestamptz AS seen_recently
    FROM "agent_sessions" a
    LEFT JOIN "agent_keys" k ON k."id" = a."agent_key_id"
    LEFT JOIN LATERAL (
      SELECT s."record_id", r."source_number" FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id"
      WHERE s."workspace_id" = a."workspace_id" AND s."leased_by" = a."public_id" AND s."status" = 'claimed'
        AND s."lease_expires_at" > ${at}::timestamptz
      ORDER BY s."id" DESC LIMIT 1) live ON true
    WHERE a."workspace_id" = ${workspace} AND a."owner_id" = ${owner}
    ORDER BY a."connected_at" DESC, a."id" DESC LIMIT ${LIMIT}`)
  return result.rows.map((raw) => {
    const parsed = row.parse(raw)
    const ticket =
      parsed.record_id !== null && parsed.source_number !== null
        ? { recordId: parsed.record_id, number: parsed.source_number }
        : null
    return {
      id: parsed.id,
      role: parsed.role,
      label: parsed.label,
      keyLabel: parsed.key_label ?? '',
      connectedAt: parsed.connected_at.toISOString(),
      lastSeenAt: parsed.last_seen_at.toISOString(),
      state: stateOf(parsed),
      ticket,
    }
  })
}
