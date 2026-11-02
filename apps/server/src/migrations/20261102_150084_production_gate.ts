import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tickets_production_state" AS ENUM('awaiting_approval', 'deploying', 'deployed', 'failed', 'timed_out');
  ALTER TABLE "products" ADD COLUMN "production_webhook_url" varchar;
  ALTER TABLE "products" ADD COLUMN "production_checks" varchar;
  ALTER TABLE "tickets" ADD COLUMN "production_state" "enum_tickets_production_state";
  ALTER TABLE "tickets" ADD COLUMN "production_requested_at" timestamp(3) with time zone;
  ALTER TABLE "tickets" ADD COLUMN "production_webhook_sent_at" timestamp(3) with time zone;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products" DROP COLUMN "production_webhook_url";
  ALTER TABLE "products" DROP COLUMN "production_checks";
  ALTER TABLE "tickets" DROP COLUMN "production_state";
  ALTER TABLE "tickets" DROP COLUMN "production_requested_at";
  ALTER TABLE "tickets" DROP COLUMN "production_webhook_sent_at";
  DROP TYPE "public"."enum_tickets_production_state";`)
}
