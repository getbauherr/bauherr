import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'watch-liveness';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'watch-liveness';
`)
}

// Postgres cannot drop an enum value; leftovers are harmless.
export async function down(_: MigrateDownArgs): Promise<void> {}
