import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_stage" ADD VALUE IF NOT EXISTS 'scan';
   ALTER TABLE "products" ADD COLUMN "security_scan_enabled" boolean DEFAULT false;
   ALTER TABLE "products" ADD COLUMN "security_scan_cron" varchar DEFAULT '0 0 4 * * 1';
   ALTER TABLE "products" ADD COLUMN "security_scan_max_budget_usd" numeric;
   ALTER TABLE "products" ADD COLUMN "security_scan_max_turns" numeric;
   ALTER TABLE "products" ADD COLUMN "security_scan_last_scan_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "security_scan_last_scan_at";
   ALTER TABLE "products" DROP COLUMN "security_scan_max_turns";
   ALTER TABLE "products" DROP COLUMN "security_scan_max_budget_usd";
   ALTER TABLE "products" DROP COLUMN "security_scan_cron";
   ALTER TABLE "products" DROP COLUMN "security_scan_enabled";`)
  // The enum value 'scan' of enum_runs_stage stays: Postgres cannot drop an enum value.
}
