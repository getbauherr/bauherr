import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

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
