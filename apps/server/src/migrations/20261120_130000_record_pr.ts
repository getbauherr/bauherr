import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "records" ADD COLUMN "pr" numeric;
  UPDATE "records" r SET "pr" = (
    SELECT (e."data"->>'pr')::numeric FROM "events" e
    WHERE e."record_id" = r."id" AND e."type" = 'build.submitted' ORDER BY e."id" DESC LIMIT 1);`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "records" DROP COLUMN IF EXISTS "pr";`)
}
