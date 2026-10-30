import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_workspaces_budget_unit" AS ENUM('usd', 'tokens');
  CREATE TYPE "public"."enum_connections_provider" AS ENUM('anthropic', 'greenpt', 'bedrock', 'vertex', 'foundry', 'anthropic-compatible', 'openai-compatible');
  ALTER TABLE "workspaces" ADD COLUMN "budget_unit" "enum_workspaces_budget_unit" DEFAULT 'usd';
  ALTER TABLE "workspaces" ADD COLUMN "budget_tokens30d" numeric DEFAULT 20000000;
  ALTER TABLE "connections" ADD COLUMN "provider" "enum_connections_provider" DEFAULT 'anthropic';
  ALTER TABLE "connections" ADD COLUMN "base_url" varchar;
  ALTER TABLE "connections" ADD COLUMN "aws_region" varchar;
  ALTER TABLE "connections" ADD COLUMN "vertex_project" varchar;
  ALTER TABLE "connections" ADD COLUMN "vertex_region" varchar;
  ALTER TABLE "connections" ADD COLUMN "azure_resource" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "workspaces" DROP COLUMN "budget_unit";
  ALTER TABLE "workspaces" DROP COLUMN "budget_tokens30d";
  ALTER TABLE "connections" DROP COLUMN "provider";
  ALTER TABLE "connections" DROP COLUMN "base_url";
  ALTER TABLE "connections" DROP COLUMN "aws_region";
  ALTER TABLE "connections" DROP COLUMN "vertex_project";
  ALTER TABLE "connections" DROP COLUMN "vertex_region";
  ALTER TABLE "connections" DROP COLUMN "azure_resource";
  DROP TYPE "public"."enum_workspaces_budget_unit";
  DROP TYPE "public"."enum_connections_provider";`)
}
