import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ALTER COLUMN "intake_excluded_labels" SET DEFAULT '["bauherr:someday"]'::jsonb;
  UPDATE "products"
  SET "intake_excluded_labels" = coalesce("intake_excluded_labels", '[]'::jsonb) || '["bauherr:someday"]'::jsonb
  WHERE NOT coalesce("intake_excluded_labels", '[]'::jsonb) ? 'bauherr:someday';`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products" ALTER COLUMN "intake_excluded_labels" SET DEFAULT '[]'::jsonb;`)
}
