import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "runs_active_per_ticket_stage";
   ALTER TABLE "runs" ALTER COLUMN "stage" TYPE varchar USING "stage"::text;
   ALTER TABLE "tickets" ALTER COLUMN "waiting_for" TYPE varchar USING "waiting_for"::text;
   DROP TYPE "public"."enum_runs_stage";
   DROP TYPE "public"."enum_tickets_waiting_for";
   ALTER TABLE "runs" ADD COLUMN "kind" varchar;
   UPDATE "runs" SET "kind" = "stage" WHERE "stage" IN ('triage', 'plan', 'build', 'review', 'scan', 'distill');
   CREATE INDEX "runs_stage_idx" ON "runs" USING btree ("stage");
   CREATE INDEX "runs_kind_idx" ON "runs" USING btree ("kind");
   CREATE UNIQUE INDEX "runs_active_per_ticket_stage" ON "runs" ("ticket_id", "stage") WHERE "status" IN ('queued', 'awaiting_session', 'running');`)
}

// Fails when a row holds a stage name outside the old enum (a custom stage).
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "runs_active_per_ticket_stage";
   DROP INDEX "runs_stage_idx";
   DROP INDEX "runs_kind_idx";
   ALTER TABLE "runs" DROP COLUMN "kind";
   CREATE TYPE "public"."enum_runs_stage" AS ENUM('plan', 'build', 'review', 'triage', 'scan', 'distill');
   CREATE TYPE "public"."enum_tickets_waiting_for" AS ENUM('plan', 'build', 'review', 'checks');
   ALTER TABLE "runs" ALTER COLUMN "stage" TYPE "enum_runs_stage" USING "stage"::"enum_runs_stage";
   ALTER TABLE "tickets" ALTER COLUMN "waiting_for" TYPE "enum_tickets_waiting_for" USING "waiting_for"::"enum_tickets_waiting_for";
   CREATE UNIQUE INDEX "runs_active_per_ticket_stage" ON "runs" ("ticket_id", "stage") WHERE "status" IN ('queued', 'awaiting_session', 'running');`)
}
