import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "expedite_at" timestamp(3) with time zone;
   ALTER TABLE "products" ADD COLUMN "expedite_skip_staging" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "expedite_at";
   ALTER TABLE "products" DROP COLUMN "expedite_skip_staging";`)
}
