import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "main_merge_sha" varchar;
  ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "main_merge_noops" integer DEFAULT 0;
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'merge-main';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'merge-main';
`)
}

// Postgres cannot drop an enum value; leftovers are harmless.
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "tickets" DROP COLUMN "main_merge_sha";
  ALTER TABLE "tickets" DROP COLUMN "main_merge_noops";`)
}
