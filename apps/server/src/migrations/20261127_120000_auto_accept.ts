import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "auto_accept" boolean DEFAULT false;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "auto_accept_max_send_back" numeric DEFAULT 10;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" DROP COLUMN IF EXISTS "auto_accept";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "auto_accept_max_send_back";`)
}
