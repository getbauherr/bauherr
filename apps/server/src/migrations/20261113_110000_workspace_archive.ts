import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "archived_at" timestamp(3) with time zone;
   ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "purge_at" timestamp(3) with time zone;
   ALTER TABLE "human_touches" ADD COLUMN IF NOT EXISTS "detail" jsonb;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "human_touches" DROP COLUMN IF EXISTS "detail";
   ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "purge_at";
   ALTER TABLE "workspaces" DROP COLUMN IF EXISTS "archived_at";`)
}
