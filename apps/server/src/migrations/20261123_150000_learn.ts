import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "statements" ADD COLUMN "source_kind" varchar;
  ALTER TABLE "statements" ADD COLUMN "source_text" varchar;
  ALTER TABLE "statements" ADD COLUMN "learn_run" numeric;
  ALTER TABLE "statements" ADD COLUMN "seen_at" timestamp(3) with time zone;
  ALTER TABLE "statements" ADD COLUMN "came_back" jsonb DEFAULT '[]'::jsonb NOT NULL;
  INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "updated_at", "created_at")
  SELECT r."workspace_id", r."id", 'learn.skipped', 'factory',
    '{"reason":"the ticket finished before Learn existed"}'::jsonb, now(), now()
  FROM "records" r
  WHERE r."stage" = 'done'
    AND EXISTS (SELECT 1 FROM "events" e WHERE e."record_id" = r."id" AND e."type" = 'result.accepted');`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "events" WHERE "type" IN ('learn.skipped', 'learn.submitted');
  DELETE FROM "statements" WHERE "kind" = 'learned';
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "came_back";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "seen_at";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "learn_run";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "source_text";
  ALTER TABLE "statements" DROP COLUMN IF EXISTS "source_kind";`)
}
