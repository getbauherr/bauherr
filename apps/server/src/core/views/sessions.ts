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
  capacity: number
  tickets: SessionTicket[]
}

export type SessionTicket = { recordId: number; number: number }

export type SessionFilter = { workspace: number; owner: number; now: Date }

const row = z.object({
  id: z.coerce.number(),
  role: z.string(),
  label: z.string().nullable(),
  key_label: z.string().nullable(),
  connected_at: z.coerce.date(),
  last_seen_at: z.coerce.date(),
  closed: z.boolean(),
  capacity: z.coerce.number(),
  tickets: z.array(z.object({ recordId: z.number(), number: z.number() })),
  seen_recently: z.boolean(),
})

const stateOf = (parsed: z.infer<typeof row>): SessionState => {
  if (parsed.closed) return 'closed'
  if (parsed.tickets.length > 0) return 'working'
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
      a."disconnected_at" IS NOT NULL AS closed, a."capacity", live."tickets",
      a."last_seen_at" >= ${recently}::timestamptz AS seen_recently
    FROM "agent_sessions" a
    LEFT JOIN "agent_keys" k ON k."id" = a."agent_key_id"
    LEFT JOIN LATERAL (
      SELECT coalesce(jsonb_agg(jsonb_build_object('recordId', s."record_id", 'number', r."source_number")
        ORDER BY s."id"), '[]'::jsonb) AS tickets
      FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id"
      WHERE s."workspace_id" = a."workspace_id" AND s."leased_by" = a."public_id" AND s."status" = 'claimed'
        AND s."lease_expires_at" > ${at}::timestamptz) live ON true
    WHERE a."workspace_id" = ${workspace} AND a."owner_id" = ${owner}
    ORDER BY a."connected_at" DESC, a."id" DESC LIMIT ${LIMIT}`)
  return result.rows.map((raw) => {
    const parsed = row.parse(raw)
    return {
      id: parsed.id,
      role: parsed.role,
      label: parsed.label,
      keyLabel: parsed.key_label ?? '',
      connectedAt: parsed.connected_at.toISOString(),
      lastSeenAt: parsed.last_seen_at.toISOString(),
      state: stateOf(parsed),
      capacity: parsed.capacity,
      tickets: parsed.tickets,
    }
  })
}
