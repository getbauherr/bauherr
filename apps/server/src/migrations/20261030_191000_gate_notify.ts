import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "gate_owners" varchar;
  ALTER TABLE "tickets" ADD COLUMN "gate_notified" varchar;
  ALTER TABLE "tickets" ADD COLUMN "gate_notified_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "gate_assignees" varchar;
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'notify-gates';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'notify-gates';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "gate_owners";
  ALTER TABLE "tickets" DROP COLUMN "gate_notified";
  ALTER TABLE "tickets" DROP COLUMN "gate_notified_at";
  ALTER TABLE "tickets" DROP COLUMN "gate_assignees";`)
}
