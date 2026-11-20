import { sql } from '@payloadcms/db-postgres'
import type { Payload, TaskConfig } from 'payload'
import { z } from 'zod'
import { claim, type Claimed } from '../../core/run/leases'
import { ROLES } from '../../core/run/schema'
import { runnerDeps } from './deps'
import type { Ended, RunnerDeps } from './types'
import { workRun } from './work'

export const RUNNER = 'runner'

const waiting = z.object({ workspace_id: z.coerce.number(), role: z.enum(ROLES) })

export const claimNext = async (deps: RunnerDeps): Promise<Claimed | null> => {
  const { payload, now } = deps.engine()
  const found = await payload.db.drizzle.execute(sql`
    SELECT s."workspace_id", s."role" FROM "stage_runs" s
    JOIN "records" r ON r."id" = s."record_id" JOIN "products" p ON p."id" = r."product_id"
    WHERE s."status" = 'queued' AND p."executor" = 'runner'
    GROUP BY s."workspace_id", s."role" ORDER BY min(s."created_at")`)
  for (const row of found.rows) {
    const { workspace_id: workspace, role } = waiting.parse(row)
    const claimed = await claim(payload, { workspace, role, by: `${RUNNER}-${role}`, now, executor: 'runner' })
    if (claimed) return claimed
  }
  return null
}

export const workNext = async (deps: RunnerDeps): Promise<Ended | 'idle'> => {
  const claimed = await claimNext(deps)
  return claimed ? workRun(claimed, deps) : 'idle'
}

export const hasQueuedRun = async (payload: Payload): Promise<boolean> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT 1 FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id"
    JOIN "products" p ON p."id" = r."product_id"
    WHERE s."status" = 'queued' AND p."executor" = 'runner' LIMIT 1`)
  return found.rows.length > 0
}

export const runAgentTask = (
  depsFor: (payload: Payload) => RunnerDeps = runnerDeps,
): TaskConfig<{ input: Record<string, never>; output: { status: string } }> => ({
  slug: 'run-agent',
  retries: 0,
  handler: async ({ req }) => ({ output: { status: await workNext(depsFor(req.payload)) } }),
})
