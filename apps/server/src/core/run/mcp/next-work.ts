import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { releaseRun } from '../../submit'
import { ModuleMissing, SessionNotFound } from '../errors'
import { claim } from '../leases'
import { contextPack } from '../pack'
import { ROLES } from '../schema'
import { defineTool, type AgentContext } from './tool'

const roleOf = async ({ deps, workspace, keyId }: AgentContext, session: string) => {
  const found = await deps.payload.db.drizzle.execute(sql`
    UPDATE "agent_sessions" SET "last_seen_at" = ${deps.now.toISOString()}, "updated_at" = now()
    WHERE "public_id" = ${session} AND "workspace_id" = ${workspace} AND "agent_key_id" = ${keyId}
      AND "disconnected_at" IS NULL
    RETURNING "role"`)
  const row = found.rows[0]
  if (!row) throw new SessionNotFound(`Session ${session} is unknown or closed: call connect again.`)
  return z.enum(ROLES).parse(row.role)
}

export const next = defineTool({
  name: 'next_work',
  description:
    'Claims the oldest queued run for the role of your session. ' +
    'Returns the run id, the lease token and the context pack, or says there is no work.',
  access: 'agent',
  input: z.strictObject({ session: z.string().min(1).max(100) }),
  run: async (input, context) => {
    const { deps, workspace } = context
    const role = await roleOf(context, input.session)
    const by = input.session
    const claimed = await claim(deps.payload, { workspace, role, by, now: deps.now, executor: 'session' })
    if (!claimed) return { status: 'idle' as const }
    const { run, token } = claimed
    const pack = await contextPack(deps, run).catch(async (error: unknown) => {
      if (error instanceof ModuleMissing) await releaseRun(run.id, token, deps)
      throw error
    })
    return { status: 'work' as const, runId: run.id, leaseToken: token, context: pack }
  },
})
