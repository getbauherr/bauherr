import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" ADD COLUMN "expedite_at" timestamp(3) with time zone;
   ALTER TABLE "tickets" ADD COLUMN "gate_notice_claim" varchar;
   ALTER TABLE "products" ADD COLUMN "expedite_skip_staging_by" varchar;
   ALTER TABLE "products" ADD COLUMN "expedite_skip_staging_at" timestamp(3) with time zone;
   ALTER TABLE "products" ADD COLUMN "expedite_skip_staging" boolean DEFAULT false;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "expedite_at";
   ALTER TABLE "tickets" DROP COLUMN "gate_notice_claim";
   ALTER TABLE "products" DROP COLUMN "expedite_skip_staging_by";
   ALTER TABLE "products" DROP COLUMN "expedite_skip_staging_at";
   ALTER TABLE "products" DROP COLUMN "expedite_skip_staging";`)
}
