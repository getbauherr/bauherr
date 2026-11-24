import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'measure-cost';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'measure-cost';
  ALTER TABLE "agent_sessions" ADD COLUMN "client_session" varchar;
  ALTER TABLE "stage_runs" ADD COLUMN "client_session" varchar;
  ALTER TABLE "stage_runs" ADD COLUMN "input_tokens" numeric;
  ALTER TABLE "stage_runs" ADD COLUMN "output_tokens" numeric;
  ALTER TABLE "stage_runs" ADD COLUMN "cost_source" varchar;
  ALTER TABLE "stage_runs" ADD COLUMN "cost_measured_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "stage_runs" DROP COLUMN IF EXISTS "cost_measured_at";
  ALTER TABLE "stage_runs" DROP COLUMN IF EXISTS "cost_source";
  ALTER TABLE "stage_runs" DROP COLUMN IF EXISTS "output_tokens";
  ALTER TABLE "stage_runs" DROP COLUMN IF EXISTS "input_tokens";
  ALTER TABLE "stage_runs" DROP COLUMN IF EXISTS "client_session";
  ALTER TABLE "agent_sessions" DROP COLUMN IF EXISTS "client_session";`)
}
