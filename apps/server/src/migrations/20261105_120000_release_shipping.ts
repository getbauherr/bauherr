import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_products_release_mode" ADD VALUE IF NOT EXISTS 'manual';
   ALTER TABLE "products" ADD COLUMN "release_reminder_days" numeric DEFAULT 7;
   ALTER TABLE "tickets" ADD COLUMN "released_in" varchar;
   ALTER TABLE "tickets" ADD COLUMN "released_at" timestamp(3) with time zone;
   CREATE INDEX "tickets_released_in_idx" ON "tickets" USING btree ("released_in");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "tickets_released_in_idx";
   ALTER TABLE "tickets" DROP COLUMN "released_at";
   ALTER TABLE "tickets" DROP COLUMN "released_in";
   ALTER TABLE "products" DROP COLUMN "release_reminder_days";`)
}
