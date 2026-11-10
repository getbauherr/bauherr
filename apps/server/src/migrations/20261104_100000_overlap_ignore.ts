import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" ADD COLUMN "overlap_ignore" jsonb;
  UPDATE "products" SET "overlap_ignore" = '[]'::jsonb;
  ALTER TABLE "tickets" ADD COLUMN "waiting_reason" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "waiting_reason";
  ALTER TABLE "products" DROP COLUMN "overlap_ignore";`)
}
