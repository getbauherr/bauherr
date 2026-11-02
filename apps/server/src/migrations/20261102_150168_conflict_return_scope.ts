import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/** Existing rows keep `conflict_returns` NULL (new rows get 0 from the collection default): the one-off recovery of Tickets parked on merge failures matches only those. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "conflict_return_base" varchar;
  ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "conflict_returns" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "conflict_return_base";
  ALTER TABLE "tickets" DROP COLUMN "conflict_returns";`)
}
