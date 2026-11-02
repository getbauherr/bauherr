import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_release_mode" AS ENUM('notes-only', 'factory');
  ALTER TABLE "products" ADD COLUMN "release_mode" "enum_products_release_mode" DEFAULT 'notes-only' NOT NULL;
  ALTER TABLE "tickets" ADD COLUMN "release_url" varchar;
  ALTER TABLE "tickets" ADD COLUMN "release_published_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "release_mode";
  ALTER TABLE "tickets" DROP COLUMN "release_url";
  ALTER TABLE "tickets" DROP COLUMN "release_published_at";
  DROP TYPE "public"."enum_products_release_mode";`)
}
