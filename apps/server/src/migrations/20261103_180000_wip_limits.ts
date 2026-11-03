import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_tickets_waiting_for" AS ENUM('plan', 'build', 'review');
  ALTER TABLE "workspaces" ADD COLUMN "wip_limits" jsonb;
  UPDATE "workspaces" SET "wip_limits" = '{"plan":3,"build":2,"review":3,"release":5}'::jsonb;
  ALTER TABLE "tickets" ADD COLUMN "waiting_for" "enum_tickets_waiting_for";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "tickets" DROP COLUMN "waiting_for";
  ALTER TABLE "workspaces" DROP COLUMN "wip_limits";
  DROP TYPE "public"."enum_tickets_waiting_for";`)
}
