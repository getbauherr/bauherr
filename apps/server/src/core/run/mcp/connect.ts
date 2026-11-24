import { randomUUID } from 'node:crypto'
import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { ClientSessionMissing } from '../errors'
import { MAX_CAPACITY, ROLES } from '../schema'
import { defineTool } from './tool'

export const connect = defineTool({
  name: 'connect',
  description:
    'Registers or refreshes your agent session for a role, once per process with a stable random instance id so ' +
    'processes sharing a key get their own session. Returns the session id to pass to next_work and the ' +
    'effective capacity (1 to 4, default 1): how many runs the session may hold at once.',
  access: 'agent',
  input: z.strictObject({
    role: z.enum(ROLES),
    label: z.string().trim().min(1).max(64).optional(),
    capacity: z.number().int().optional(),
    clientSession: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{8,64}$/)
      .describe(
        'Your Claude Code session id: the value of the environment variable CLAUDE_CODE_SESSION_ID ' +
          '(run printenv CLAUDE_CODE_SESSION_ID). Pass it again when it changes, for example after /clear.',
      )
      .optional(),
    instance: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .describe(
        'Stable random id of this client process, such as a UUID: generate it once per process and pass the same ' +
          'value on every reconnect. Processes with the same key and role but different ids get separate sessions.',
      )
      .optional(),
  }),
  run: async ({ role, label, capacity: asked, instance, clientSession }, { deps, workspace, keyId }) => {
    if (!clientSession) {
      throw new ClientSessionMissing(
        'Pass clientSession: run printenv CLAUDE_CODE_SESSION_ID in your shell and call connect again with its value.',
      )
    }
    const capacity = Math.min(MAX_CAPACITY, Math.max(1, asked ?? 1))
    const clientKey = `key-${keyId}:${role}${instance ? `:${instance}` : ''}`
    const at = deps.now.toISOString()
    const result = await deps.payload.db.drizzle.execute(sql`
      INSERT INTO "agent_sessions" ("workspace_id", "public_id", "owner_id", "agent_key_id", "role", "label",
        "capacity", "client_session", "client_key", "connected_at", "last_seen_at", "updated_at", "created_at")
      SELECT ${workspace}, ${randomUUID()}, k."owner_id", k."id", ${role}, ${label ?? null}, ${capacity},
        ${clientSession}, ${clientKey}, ${at}, ${at}, now(), now()
      FROM "agent_keys" k WHERE k."id" = ${keyId}
      ON CONFLICT ("workspace_id", "owner_id", "client_key") DO UPDATE SET "label" = EXCLUDED."label",
        "capacity" = EXCLUDED."capacity", "client_session" = EXCLUDED."client_session",
        "connected_at" = EXCLUDED."connected_at",
        "last_seen_at" = EXCLUDED."last_seen_at",
        "disconnected_at" = NULL, "end_reason" = NULL, "updated_at" = now()
      RETURNING "public_id"`)
    return { session: z.string().parse(result.rows[0]?.public_id), role, capacity }
  },
})
