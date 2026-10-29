import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_cost_source" RENAME VALUE 'estimate' TO 'sdk-estimate';
  ALTER TYPE "public"."enum_runs_reconcile_status" ADD VALUE IF NOT EXISTS 'unavailable';
  ALTER TABLE "runs" ALTER COLUMN "cost_source" SET DEFAULT 'sdk-estimate';
  ALTER TABLE "runs" ADD COLUMN "gateway_tokens_in" numeric;
  ALTER TABLE "runs" ADD COLUMN "gateway_tokens_out" numeric;
  ALTER TABLE "runs" ADD COLUMN "gateway_tokens_total" numeric;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" DROP COLUMN "gateway_tokens_in";
  ALTER TABLE "runs" DROP COLUMN "gateway_tokens_out";
  ALTER TABLE "runs" DROP COLUMN "gateway_tokens_total";
  ALTER TABLE "runs" ALTER COLUMN "cost_source" SET DEFAULT 'estimate';
  ALTER TYPE "public"."enum_runs_cost_source" RENAME VALUE 'sdk-estimate' TO 'estimate';`)
}
