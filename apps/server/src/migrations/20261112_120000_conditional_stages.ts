import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "path_sets" jsonb DEFAULT '{}'::jsonb;
  UPDATE "products" SET "path_sets" = '{}'::jsonb;
  ALTER TABLE "ticket_events" ADD COLUMN "note" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "ticket_events" DROP COLUMN "note";
  ALTER TABLE "products" DROP COLUMN "path_sets";`)
}
