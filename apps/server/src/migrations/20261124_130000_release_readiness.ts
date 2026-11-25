import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "release_mode" varchar DEFAULT 'factory';
  ALTER TABLE "ticket_sources" ADD COLUMN "release_facts" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" DROP COLUMN IF EXISTS "release_mode";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "release_facts";`)
}
