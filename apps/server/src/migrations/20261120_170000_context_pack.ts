import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "ticket_sources" ADD COLUMN "agents_file" varchar;
  ALTER TABLE "ticket_sources" ADD COLUMN "agents_file_cut" boolean;
  ALTER TABLE "stage_runs" ADD COLUMN "context" jsonb;
  CREATE INDEX "statements_fts_idx" ON "statements" USING gin (to_tsvector('simple', "text"));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX IF EXISTS "statements_fts_idx";
  ALTER TABLE "stage_runs" DROP COLUMN IF EXISTS "context";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "agents_file_cut";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "agents_file";`)
}
