import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { sessionTimeoutS } from './sessions'

/** `working`: connected sessions that hold a running Run plus running autonomous Runs (Runner, CI); `idle`: connected sessions without one. */
export type Presence = { working: number; idle: number }

/** One round trip. A session is connected while it is not disconnected and either holds a running Run or was seen within `sessionTimeoutS()` (the Team page's rule). */
export const loadPresence = async (payload: Payload, workspace: number | string): Promise<Presence> => {
  const { rows } = await payload.db.drizzle.execute(sql`
    WITH s AS (
      SELECT EXISTS (SELECT 1 FROM "runs" r WHERE r."session_id" = a."id" AND r."status" = 'running') AS busy, a."last_seen_at"
      FROM "agent_sessions" a WHERE a."workspace_id" = ${workspace} AND a."disconnected_at" IS NULL
    )
    SELECT
      (SELECT count(*) FROM s WHERE busy)::int AS "busy",
      (SELECT count(*) FROM s WHERE NOT busy AND "last_seen_at" >= now() - make_interval(secs => ${sessionTimeoutS()}))::int AS "idle",
      (SELECT count(*) FROM "runs" WHERE "workspace_id" = ${workspace} AND "status" = 'running' AND "mode" = 'autonomous')::int AS "auto"`)
  const r = rows[0] as { busy: number; idle: number; auto: number }
  return { working: r.busy + r.auto, idle: r.idle }
}
