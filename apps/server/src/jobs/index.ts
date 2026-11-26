import { sql } from '@payloadcms/db-postgres'
import type { Payload, TaskConfig } from 'payload'
import { expireRunsTask } from '../core/expire-task'
import { mirrorItemTask, mirrorSyncTask } from '../core/jobs'
import { advanceReleasesTask } from '../core/releases/job'
import { readinessTask } from '../core/readiness/job'
import { checkGateway } from '../lib/gateway-health'
import { resync } from '../lib/knowledge'
import { refreshPrices } from '../lib/prices'
import { scheduled } from '../lib/schedule'
import { live, purgeDueWorkspaces } from '../lib/workspace-delete'
import { engineDeps } from './engine-deps'
import { afterSync, intakeSweepTask } from './intake'
import { measureCostTask } from './measure-cost'
import { runAgentTask } from './runner'

export const STALE_JOB_MS = 60 * 60_000

export const scheduledTasks = (): { slug: string; cron: string }[] =>
  TASKS.flatMap((t) => (t.schedule?.[0] ? [{ slug: t.slug, cron: t.schedule[0].cron }] : []))

export const syncJobEnums = async (payload: Payload, slugs = TASKS.map((t) => t.slug)): Promise<void> => {
  for (const type of ['enum_payload_jobs_task_slug', 'enum_payload_jobs_log_task_slug']) {
    if (!(await payload.db.drizzle.execute(sql`SELECT to_regtype(${`public.${type}`}) AS t`)).rows[0]?.t) continue
    for (const slug of slugs)
      await payload.db.drizzle.execute(
        sql.raw(`ALTER TYPE "public"."${type}" ADD VALUE IF NOT EXISTS '${slug.replace(/'/g, "''")}'`),
      )
  }
}

export const reclaimStaleJobs = async (
  payload: Payload,
  now = Date.now(),
  maxAgeMs = STALE_JOB_MS,
): Promise<number> => {
  const rows = (
    await payload.db.drizzle.execute(
      sql`UPDATE "payload_jobs" SET "processing" = false, "has_error" = true,
        "error" = ${JSON.stringify({ message: 'reclaimed: no progress' })}::jsonb, "updated_at" = now()
        WHERE "processing" AND "completed_at" IS NULL AND "task_slug"::text IN (${sql.join(
          TASKS.filter((t) => t.schedule?.length).map((t) => sql`${t.slug}`),
          sql`, `,
        )}) AND "updated_at" < ${new Date(now - maxAgeMs).toISOString()} RETURNING "id", "task_slug"`,
    )
  ).rows
  for (const r of rows) payload.logger.warn({ job: r.id, task: r.task_slug }, 'reclaimed stale scheduled job')
  return rows.length
}

export const reclaimJobs: TaskConfig<{ input: Record<string, never>; output: { reclaimed: number } }> = {
  slug: 'reclaim-jobs',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  handler: async ({ req }) => {
    return { output: { reclaimed: await reclaimStaleJobs(req.payload) } }
  },
}

export const resyncKnowledge: TaskConfig<{ input: Record<string, never>; output: { indexed: number } }> = {
  slug: 'resync-knowledge',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  concurrency: () => 'resync-knowledge',
  handler: async ({ req }) => {
    const { payload } = req
    let indexed = 0
    for (const w of (
      await payload.find({
        collection: 'workspaces',
        where: live,
        limit: 1000,
        pagination: false,
        depth: 0,
        select: { id: true },
        overrideAccess: true,
      })
    ).docs) {
      try {
        if (await resync(payload, w.id)) indexed++
      } catch (e) {
        payload.logger.error({ err: e, workspace: w.id }, 'resync-knowledge failed')
      }
    }
    return { output: { indexed } }
  },
}

export const watchGatewayTask: TaskConfig<{ input: Record<string, never>; output: { checked: boolean } }> = {
  slug: 'watch-gateway',
  schedule: scheduled('0 * * * * *'),
  retries: 0,
  handler: async ({ req }) => {
    if (!process.env.GATEWAY_URL) return { output: { checked: false } }
    await checkGateway(req.payload)
    return { output: { checked: true } }
  },
}

export const refreshPricesTask: TaskConfig<{ input: Record<string, never>; output: { models: number } }> = {
  slug: 'refresh-prices',
  schedule: scheduled('0 7 * * * *'),
  retries: 0,
  handler: async ({ req }) => {
    return { output: { models: (await refreshPrices(req.payload))?.models ?? 0 } }
  },
}

export const purgeWorkspacesTask: TaskConfig<{ input: Record<string, never>; output: { purged: number } }> = {
  slug: 'purge-workspaces',
  schedule: scheduled('0 0 4 * * *'),
  retries: 0,
  handler: async ({ req }) => {
    const purged = await purgeDueWorkspaces(req.payload)
    if (purged.length) req.payload.logger.info({ purged }, 'purge-workspaces')
    return { output: { purged: purged.length } }
  },
}

export const expireRunsJob = expireRunsTask(scheduled('0 * * * * *'), engineDeps)

export const TASKS = [
  reclaimJobs,
  resyncKnowledge,
  watchGatewayTask,
  refreshPricesTask,
  purgeWorkspacesTask,
  expireRunsJob,
  mirrorSyncTask(scheduled('0 * * * * *'), afterSync),
  mirrorItemTask(afterSync),
  intakeSweepTask(scheduled('0 * * * * *')),
  readinessTask(scheduled('0 0 8 * * *')),
  advanceReleasesTask(scheduled('0 * * * * *')),
  runAgentTask(),
  measureCostTask,
]
