import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_templates_name" ADD VALUE IF NOT EXISTS 'progress';
   ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'sync-progress';
   ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'sync-progress';
   ALTER TABLE "tickets" ADD COLUMN "progress_hash" varchar;
   ALTER TABLE "tickets" ADD COLUMN "progress_comment_id" varchar;
   ALTER TABLE "tickets" ADD COLUMN "progress_notified" varchar;
   ALTER TABLE "workspaces" ADD COLUMN "progress_comments" boolean DEFAULT true;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "progress_hash";
   ALTER TABLE "tickets" DROP COLUMN "progress_comment_id";
   ALTER TABLE "tickets" DROP COLUMN "progress_notified";
   ALTER TABLE "workspaces" DROP COLUMN "progress_comments";`)
}
