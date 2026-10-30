import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_stage" ADD VALUE IF NOT EXISTS 'review';
  CREATE TYPE "public"."enum_runs_verdict" AS ENUM('clean', 'changes');
  CREATE TYPE "public"."enum_tickets_review_state" AS ENUM('waiting_checks', 'merged', 'ready_for_human', 'needs_human');
  ALTER TABLE "runs" ADD COLUMN "verdict" "enum_runs_verdict";
  ALTER TABLE "runs" ADD COLUMN "findings" jsonb;
  ALTER TABLE "runs" ADD COLUMN "reviewed_sha" varchar;
  ALTER TABLE "tickets" ADD COLUMN "review_waiting_since" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "merge_failures" numeric DEFAULT 0;
  ALTER TABLE "tickets" ADD COLUMN "review_state" "enum_tickets_review_state";
  ALTER TABLE "tickets" ADD COLUMN "review_rounds" numeric DEFAULT 0;
  ALTER TABLE "products" ADD COLUMN "auto_merge" boolean DEFAULT true;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" DROP COLUMN "verdict";
  ALTER TABLE "runs" DROP COLUMN "findings";
  ALTER TABLE "runs" DROP COLUMN "reviewed_sha";
  ALTER TABLE "tickets" DROP COLUMN "review_waiting_since";
  ALTER TABLE "tickets" DROP COLUMN "merge_failures";
  ALTER TABLE "tickets" DROP COLUMN "review_state";
  ALTER TABLE "tickets" DROP COLUMN "review_rounds";
  ALTER TABLE "products" DROP COLUMN "auto_merge";
  DROP TYPE "public"."enum_runs_verdict";
  DROP TYPE "public"."enum_tickets_review_state";`)
  // The enum value 'review' of enum_runs_stage stays: Postgres cannot drop an enum value.
}
