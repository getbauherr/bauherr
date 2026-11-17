import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "parked_need" varchar;
   CREATE INDEX IF NOT EXISTS "tickets_parked_need_idx" ON "tickets" USING btree ("parked_need");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "tickets_parked_need_idx";
   ALTER TABLE "tickets" DROP COLUMN IF EXISTS "parked_need";`)
}
