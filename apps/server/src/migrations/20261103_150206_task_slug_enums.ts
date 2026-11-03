import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'publish-release';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'publish-release';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'resync-knowledge';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'resync-knowledge';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'watch-knowledge-prs';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'watch-knowledge-prs';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'reconcile-costs';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'reconcile-costs';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'prune-request-logs';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'prune-request-logs';
`)
}

// Postgres cannot drop an enum value; leftovers are harmless.
export async function down(_: MigrateDownArgs): Promise<void> {}
