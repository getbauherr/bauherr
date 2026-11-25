import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  UPDATE "records" SET "card" = NULL, "stage" = 'done', "waiting_on" = 'nobody', "updated_at" = now()
  WHERE "card"->>'reason' IN ('production', 'production-held');
  ALTER TABLE "products" DROP COLUMN IF EXISTS "production_gate";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "production_gate" boolean DEFAULT false;`)
}
