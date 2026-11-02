import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_release_mode" AS ENUM('notes-only', 'factory');
  ALTER TABLE "products" ADD COLUMN "release_mode" "enum_products_release_mode" DEFAULT 'notes-only' NOT NULL;
  ALTER TABLE "tickets" ADD COLUMN "release_url" varchar;
  ALTER TABLE "tickets" ADD COLUMN "release_published_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "release_retry_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "release_attempts" numeric DEFAULT 0;
  ALTER TABLE "tickets" ADD COLUMN "release_error" varchar;
  ALTER TABLE "tickets" ADD COLUMN "release_notes" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "release_mode";
  ALTER TABLE "tickets" DROP COLUMN "release_url";
  ALTER TABLE "tickets" DROP COLUMN "release_published_at";
  ALTER TABLE "tickets" DROP COLUMN "release_retry_at";
  ALTER TABLE "tickets" DROP COLUMN "release_attempts";
  ALTER TABLE "tickets" DROP COLUMN "release_error";
  ALTER TABLE "tickets" DROP COLUMN "release_notes";
  DROP TYPE "public"."enum_products_release_mode";`)
}
