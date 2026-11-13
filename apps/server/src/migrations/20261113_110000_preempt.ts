import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/** A hotfix pauses one busy session: `runs.preempted_by/_for/preempt_at`, reason kind `preempted`, `workspaces.preempt_for_hotfix`. */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_runs_reason_kind" ADD VALUE IF NOT EXISTS 'preempted';
  ALTER TABLE "runs" ADD COLUMN "preempted_by" numeric;
  ALTER TABLE "runs" ADD COLUMN "preempted_for" numeric;
  ALTER TABLE "runs" ADD COLUMN "preempt_at" timestamp(3) with time zone;
  ALTER TABLE "workspaces" ADD COLUMN "preempt_for_hotfix" boolean DEFAULT true;
  CREATE INDEX "runs_session_preempt_idx" ON "runs" USING btree ("session_id") WHERE "preempt_at" IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DROP INDEX "runs_session_preempt_idx";
  ALTER TABLE "runs" DROP COLUMN "preempted_by";
  ALTER TABLE "runs" DROP COLUMN "preempted_for";
  ALTER TABLE "runs" DROP COLUMN "preempt_at";
  ALTER TABLE "workspaces" DROP COLUMN "preempt_for_hotfix";`)
}
