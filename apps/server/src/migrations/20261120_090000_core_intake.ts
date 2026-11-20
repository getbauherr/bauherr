import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const SLUG = sql`
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'intake-sweep';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'intake-sweep';`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(SLUG)
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "intake_excluded_labels" jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE "products" ADD COLUMN "outside_issues_per_day" numeric DEFAULT 5;
  ALTER TABLE "products" ADD COLUMN "reporter_remind_days" numeric DEFAULT 7;
  ALTER TABLE "products" ADD COLUMN "reporter_silent_days" numeric DEFAULT 21;
  ALTER TABLE "products" ADD COLUMN "backlog_brief_limit" numeric DEFAULT 5;
  ALTER TABLE "products" ADD COLUMN "required_checks" varchar;
  ALTER TABLE "records" ADD COLUMN "parked" varchar;
  ALTER TABLE "mirror_items" ADD COLUMN "merge_sha" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" DROP COLUMN IF EXISTS "intake_excluded_labels";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "outside_issues_per_day";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "reporter_remind_days";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "reporter_silent_days";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "backlog_brief_limit";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "required_checks";
  ALTER TABLE "records" DROP COLUMN IF EXISTS "parked";
  ALTER TABLE "mirror_items" DROP COLUMN IF EXISTS "merge_sha";`)
}
