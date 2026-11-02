import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_connections_provider" ADD VALUE IF NOT EXISTS 'bedrock-iam';
  ALTER TYPE "public"."enum_connections_provider" ADD VALUE IF NOT EXISTS 'foundry-entra';
  ALTER TYPE "public"."enum_connections_provider" ADD VALUE IF NOT EXISTS 'bedrock-ambient';
  ALTER TYPE "public"."enum_connections_provider" ADD VALUE IF NOT EXISTS 'vertex-ambient';
  ALTER TYPE "public"."enum_connections_provider" ADD VALUE IF NOT EXISTS 'foundry-ambient';
  ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "azure_tenant" varchar;
  ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "azure_client" varchar;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "connections" DROP COLUMN "azure_tenant";
  ALTER TABLE "connections" DROP COLUMN "azure_client";`)
}
