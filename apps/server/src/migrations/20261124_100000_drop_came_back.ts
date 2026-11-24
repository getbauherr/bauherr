import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  UPDATE "stage_runs" SET "status" = 'failed', "error" = 'The Learn step was removed.', "updated_at" = now()
    WHERE "stage" = 'done' AND "status" IN ('queued', 'claimed');
  CREATE TABLE "learn_events_archive" (LIKE "events");
  ALTER TABLE "learn_events_archive"
    ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") ON DELETE CASCADE,
    ADD FOREIGN KEY ("record_id") REFERENCES "records" ("id") ON DELETE CASCADE;
  INSERT INTO "learn_events_archive" SELECT * FROM "events" WHERE "type" IN ('learn.skipped', 'learn.submitted');
  DELETE FROM "events" WHERE "type" IN ('learn.skipped', 'learn.submitted');
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "came_back";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "seen_at";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "learn_run";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "check_issue";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "statements" ADD COLUMN "learn_run" numeric;
  ALTER TABLE "statements" ADD COLUMN "seen_at" timestamp(3) with time zone;
  ALTER TABLE "statements" ADD COLUMN "came_back" jsonb DEFAULT '[]'::jsonb NOT NULL;
  ALTER TABLE "statements" ADD COLUMN "check_issue" numeric;
  INSERT INTO "events" SELECT * FROM "learn_events_archive";
  DROP TABLE "learn_events_archive";`)
}
