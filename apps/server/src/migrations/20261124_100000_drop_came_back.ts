import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
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
  ALTER TABLE "statements" ADD COLUMN "check_issue" numeric;`)
}
