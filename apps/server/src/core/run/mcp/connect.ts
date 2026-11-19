import { randomUUID } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { ROLES } from '../schema'
import { defineTool } from './tool'

export const connect = defineTool({
  name: 'connect',
  description: 'Registers or refreshes your agent session for a role. Returns the session id to pass to next_work.',
  access: 'agent',
  input: z.strictObject({ role: z.enum(ROLES), label: z.string().trim().min(1).max(64).optional() }),
  run: async ({ role, label }, { deps, workspace, keyId }) => {
    const at = deps.now.toISOString()
    const result = await deps.payload.db.drizzle.execute(sql`
      INSERT INTO "agent_sessions" ("workspace_id", "public_id", "owner_id", "agent_key_id", "role", "label",
        "client_key", "connected_at", "last_seen_at", "updated_at", "created_at")
      SELECT ${workspace}, ${randomUUID()}, k."owner_id", k."id", ${role}, ${label ?? null},
        ${`key-${keyId}:${role}`}, ${at}, ${at}, now(), now()
      FROM "agent_keys" k WHERE k."id" = ${keyId}
      ON CONFLICT ("workspace_id", "owner_id", "client_key") DO UPDATE SET "label" = EXCLUDED."label",
        "connected_at" = EXCLUDED."connected_at", "last_seen_at" = EXCLUDED."last_seen_at",
        "disconnected_at" = NULL, "end_reason" = NULL, "updated_at" = now()
      RETURNING "public_id"`)
    return { session: z.string().parse(result.rows[0]?.public_id), role }
  },
})
