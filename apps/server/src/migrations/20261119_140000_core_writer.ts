import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "records" ADD COLUMN "status_comment_id" varchar;
  ALTER TABLE "records" ADD COLUMN "status_comment_hash" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "records" DROP COLUMN IF EXISTS "status_comment_id";
  ALTER TABLE "records" DROP COLUMN IF EXISTS "status_comment_hash";`)
}
