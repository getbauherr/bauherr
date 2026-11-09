import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_tickets_review_state" ADD VALUE IF NOT EXISTS 'queued';
  DO $$ BEGIN
    CREATE TYPE "public"."enum_products_merge_mode" AS ENUM('direct', 'queue', 'train');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "merge_mode" "enum_products_merge_mode" DEFAULT 'direct' NOT NULL;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "train_state" jsonb;
  ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "merge_preflight" jsonb;
  ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "queued_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "train_failures" numeric DEFAULT 0;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "train_failures";
  ALTER TABLE "tickets" DROP COLUMN "queued_at";
  ALTER TABLE "products" DROP COLUMN "merge_preflight";
  ALTER TABLE "products" DROP COLUMN "train_state";
  ALTER TABLE "products" DROP COLUMN "merge_mode";
  DROP TYPE "public"."enum_products_merge_mode";`)
}
