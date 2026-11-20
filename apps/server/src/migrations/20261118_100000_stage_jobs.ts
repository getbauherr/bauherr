import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" ADD COLUMN "job" varchar;
   ALTER TABLE "ticket_events" ADD COLUMN "job" varchar;
   ALTER TABLE "tickets" ADD COLUMN "stage_since" timestamp(3) with time zone;
   CREATE INDEX "runs_job_idx" ON "runs" USING btree ("job");
   DROP INDEX "runs_active_per_ticket_stage";
   CREATE UNIQUE INDEX "runs_active_per_ticket_stage" ON "runs" ("ticket_id", "stage", coalesce("job", '')) WHERE
       "status" IN ('queued', 'awaiting_session', 'running');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "runs_active_per_ticket_stage";
   DROP INDEX "runs_job_idx";
   ALTER TABLE "runs" DROP COLUMN "job";
   ALTER TABLE "ticket_events" DROP COLUMN "job";
   ALTER TABLE "tickets" DROP COLUMN "stage_since";
   CREATE UNIQUE INDEX "runs_active_per_ticket_stage" ON "runs" ("ticket_id", "stage") WHERE "status" IN ('queued',
       'awaiting_session', 'running');`)
}
