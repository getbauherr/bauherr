import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_status" ADD VALUE 'abandoned';
  ALTER TABLE "runs" ADD COLUMN "lease_hash" varchar;
  ALTER TABLE "runs" ADD COLUMN "previous_run_id" integer;
  ALTER TABLE "runs" ADD CONSTRAINT "runs_previous_run_id_runs_id_fk" FOREIGN KEY ("previous_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "runs_previous_run_idx" ON "runs" USING btree ("previous_run_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "runs" DROP CONSTRAINT "runs_previous_run_id_runs_id_fk";
  DROP INDEX "runs_previous_run_idx";
  ALTER TABLE "runs" DROP COLUMN "lease_hash";
  ALTER TABLE "runs" DROP COLUMN "previous_run_id";
  UPDATE "runs" SET "status" = 'needs_human' WHERE "status" = 'abandoned';`)
}
