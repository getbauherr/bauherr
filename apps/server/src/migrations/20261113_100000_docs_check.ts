import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "docs_check_paths" jsonb DEFAULT '["README.md","docs/**/*.md"]'::jsonb;
   ALTER TABLE "products" ADD COLUMN "docs_check_last_check_at" timestamp(3) with time zone;
   ALTER TABLE "products" ADD COLUMN "docs_check_last_check_run" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "docs_check_last_check_run";
   ALTER TABLE "products" DROP COLUMN "docs_check_last_check_at";
   ALTER TABLE "products" DROP COLUMN "docs_check_paths";`)
}
