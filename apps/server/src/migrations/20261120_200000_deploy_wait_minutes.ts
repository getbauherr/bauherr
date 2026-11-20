import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN "deploy_wait_minutes" numeric DEFAULT 60;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" DROP COLUMN IF EXISTS "deploy_wait_minutes";`)
}
