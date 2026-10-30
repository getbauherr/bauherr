import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_products_deploy_mode" AS ENUM('observe-ci', 'webhook');
  CREATE TYPE "public"."enum_tickets_release_state" AS ENUM('waiting', 'on_staging', 'timed_out');
  ALTER TABLE "products" ADD COLUMN "staging_url" varchar;
  ALTER TABLE "products" ADD COLUMN "deploy_mode" "enum_products_deploy_mode" DEFAULT 'observe-ci' NOT NULL;
  ALTER TABLE "products" ADD COLUMN "deploy_webhook_url" varchar;
  ALTER TABLE "products" ADD COLUMN "deploy_checks" varchar;
  ALTER TABLE "products" ADD COLUMN "production_gate" boolean DEFAULT false;
  ALTER TABLE "tickets" ADD COLUMN "merge_sha" varchar;
  ALTER TABLE "tickets" ADD COLUMN "release_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "deploy_requested_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "release_state" "enum_tickets_release_state";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "staging_url";
  ALTER TABLE "products" DROP COLUMN "deploy_mode";
  ALTER TABLE "products" DROP COLUMN "deploy_webhook_url";
  ALTER TABLE "products" DROP COLUMN "deploy_checks";
  ALTER TABLE "products" DROP COLUMN "production_gate";
  ALTER TABLE "tickets" DROP COLUMN "merge_sha";
  ALTER TABLE "tickets" DROP COLUMN "release_at";
  ALTER TABLE "tickets" DROP COLUMN "deploy_requested_at";
  ALTER TABLE "tickets" DROP COLUMN "release_state";
  DROP TYPE "public"."enum_products_deploy_mode";
  DROP TYPE "public"."enum_tickets_release_state";`)
}
