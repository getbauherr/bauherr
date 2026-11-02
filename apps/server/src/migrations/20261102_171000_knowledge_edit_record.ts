import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "human_touches" ADD COLUMN "repo" varchar;
  ALTER TABLE "human_touches" ADD COLUMN "path" varchar;
  ALTER TABLE "human_touches" ADD COLUMN "pr_number" numeric;
  ALTER TABLE "human_touches" ADD COLUMN "head_sha" varchar;
  ALTER TABLE "human_touches" ADD COLUMN "base_content" varchar;
  ALTER TABLE "human_touches" ADD COLUMN "status" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "human_touches" DROP COLUMN "repo";
  ALTER TABLE "human_touches" DROP COLUMN "path";
  ALTER TABLE "human_touches" DROP COLUMN "pr_number";
  ALTER TABLE "human_touches" DROP COLUMN "head_sha";
  ALTER TABLE "human_touches" DROP COLUMN "base_content";
  ALTER TABLE "human_touches" DROP COLUMN "status";`)
}
