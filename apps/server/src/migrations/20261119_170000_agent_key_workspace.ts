import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "agent_keys" ADD COLUMN "workspace_id" integer;
  UPDATE "agent_keys" k SET "workspace_id" = (
    SELECT t."tenant_id" FROM "bauherren_tenants" t WHERE t."_parent_id" = k."owner_id"
    ORDER BY t."_order" LIMIT 1);
  DELETE FROM "agent_keys" WHERE "workspace_id" IS NULL;
  ALTER TABLE "agent_keys" ALTER COLUMN "workspace_id" SET NOT NULL;
  ALTER TABLE "agent_keys" ADD CONSTRAINT "agent_keys_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "agent_keys_workspace_idx" ON "agent_keys"
    USING btree ("workspace_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "agent_keys" DROP COLUMN IF EXISTS "workspace_id";`)
}
