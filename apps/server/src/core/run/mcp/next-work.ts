import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { AdvanceDeps } from '../../engine'
import { fold } from '../../fold'
import type { TicketRecord } from '../../record/schema'
import { readEvents, readRecord } from '../../record/store'
import { releaseRun } from '../../submit'
import { ModuleMissing, SessionNotFound } from '../errors'
import { claim } from '../leases'
import { ROLES, type Run } from '../schema'
import { defineTool, type AgentContext } from './tool'

export type ContextPack = {
  runId: number
  stage: Run['stage']
  role: Run['role']
  record: TicketRecord
  resultSchema: unknown
  note: string | null
}

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

const pendingNote = async (deps: AdvanceDeps, run: Run): Promise<string | null> => {
  const events = await readEvents(deps.payload, run.recordId)
  const started = events.findIndex((e) => e.type === 'run.started' && e.data.runId === String(run.id))
  return fold(started < 0 ? events : events.slice(0, started)).note
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
    const claimed = await claim(deps.payload, { workspace, role, by: input.session, now: deps.now })
    if (!claimed) return { status: 'idle' as const }
    const { run, token } = claimed
    const module = deps.modules[run.stage]
    if (!module) {
      await releaseRun(run.id, token, deps)
      throw new ModuleMissing(`No module is registered for stage ${run.stage} yet: nothing can be worked here.`)
    }
    const stored = await readRecord(deps.payload, run.recordId)
    const pack: ContextPack = {
      runId: run.id,
      stage: run.stage,
      role: run.role,
      record: stored.record,
      resultSchema: z.toJSONSchema(module.resultSchema, { io: 'input' }),
      note: await pendingNote(deps, run),
    }
    return { status: 'work' as const, runId: run.id, leaseToken: token, context: pack }
  },
})
