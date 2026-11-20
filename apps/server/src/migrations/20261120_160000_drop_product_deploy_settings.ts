import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "products" DROP COLUMN IF EXISTS "deploy_mode";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "deploy_webhook_url";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "production_webhook_url";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "production_checks";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "release_mode";
  DROP TYPE IF EXISTS "public"."enum_products_deploy_mode";
  DROP TYPE IF EXISTS "public"."enum_products_release_mode";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_products_deploy_mode" AS ENUM('observe-ci', 'webhook');
  CREATE TYPE "public"."enum_products_release_mode" AS ENUM('notes-only', 'factory', 'manual');
  ALTER TABLE "products" ADD COLUMN "deploy_mode" "enum_products_deploy_mode" DEFAULT 'observe-ci' NOT NULL;
  ALTER TABLE "products" ADD COLUMN "deploy_webhook_url" varchar;
  ALTER TABLE "products" ADD COLUMN "production_webhook_url" varchar;
  ALTER TABLE "products" ADD COLUMN "production_checks" varchar;
  ALTER TABLE "products" ADD COLUMN "release_mode" "enum_products_release_mode" DEFAULT 'notes-only' NOT NULL;`)
}
