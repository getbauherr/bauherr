import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { sessionTimeoutS } from './sessions'

export type Presence = { working: number; idle: number }

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

export const connectedOfRole = async (payload: Payload, workspace: number | string, role: string): Promise<number> => {
  const { rows } = await payload.db.drizzle.execute(sql`
    SELECT count(*)::int AS "n" FROM "agent_sessions" a
    WHERE a."workspace_id" = ${workspace} AND a."role" = ${role} AND a."disconnected_at" IS NULL
      AND (a."last_seen_at" >= now() - make_interval(secs => ${sessionTimeoutS()}) OR EXISTS (SELECT 1 FROM "runs" r WHERE r."session_id" = a."id" AND r."status" = 'running'))`)
  return (rows[0] as { n: number }).n
}
