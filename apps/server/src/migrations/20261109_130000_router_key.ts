import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_connections_provider" ADD VALUE IF NOT EXISTS 'router';
  ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "router_key" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "workspaces" DROP COLUMN "router_key";`)
}
