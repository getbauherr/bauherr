import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "connections" ADD COLUMN "webhook_secret" varchar;
  ALTER TABLE "connections" ADD COLUMN "webhook_delivered_at" timestamp(3) with time zone;
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'mirror-item';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'mirror-item';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "connections" DROP COLUMN IF EXISTS "webhook_secret";
  ALTER TABLE "connections" DROP COLUMN IF EXISTS "webhook_delivered_at";`)
}
