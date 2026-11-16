import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "epic" jsonb;
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "slice" jsonb;
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "parked" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "parked";
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "slice";
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "epic";`)
}
