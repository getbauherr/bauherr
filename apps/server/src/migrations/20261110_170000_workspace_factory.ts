import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "workflow_versions" ALTER COLUMN "product_id" DROP NOT NULL;
  ALTER TABLE "workflow_versions" ADD COLUMN "source" varchar;
  ALTER TABLE "workflow_versions" ADD COLUMN "hash" varchar;
  ALTER TABLE "workflow_versions" ADD COLUMN "applied_by" varchar;
  ALTER TABLE "workflow_versions" ADD COLUMN "applied_via" varchar;
  ALTER TABLE "workflow_versions" ADD COLUMN "note" varchar;
  CREATE INDEX "workflow_versions_hash_idx" ON "workflow_versions" USING btree ("hash");
  ALTER TABLE "workspaces" ADD COLUMN "workflow_version_id" integer;
  ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "workspaces_workflow_version_idx" ON "workspaces" USING btree ("workflow_version_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "workspaces" DROP COLUMN "workflow_version_id";
  DROP INDEX "workflow_versions_hash_idx";
  ALTER TABLE "workflow_versions" DROP COLUMN "source", DROP COLUMN "hash", DROP COLUMN "applied_by", DROP COLUMN "applied_via", DROP COLUMN "note";`)
}
