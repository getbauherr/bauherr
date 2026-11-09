import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "router_budget_share" numeric DEFAULT 20;
  UPDATE "workspaces" SET "router_budget_share" = 20 WHERE "router_budget_share" IS NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "workspaces" DROP COLUMN "router_budget_share";`)
}
