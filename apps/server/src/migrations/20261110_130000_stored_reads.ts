import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "open_critical_decisions" numeric;
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "liveness" jsonb;
   ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "overlap_suggestions" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN IF EXISTS "overlap_suggestions";
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "liveness";
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "open_critical_decisions";`)
}
