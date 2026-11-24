import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "repo_instruction_files";
  UPDATE "ticket_sources" SET "facts_at" = NULL;
  ALTER TABLE "repo_instruction_files" ADD COLUMN "repo" varchar NOT NULL;
  DROP INDEX "workspace_product_path_idx";
  CREATE UNIQUE INDEX "workspace_product_repo_path_idx" ON "repo_instruction_files"
    USING btree ("workspace_id","product_id","repo","path");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "repo_instruction_files";
  DROP INDEX "workspace_product_repo_path_idx";
  ALTER TABLE "repo_instruction_files" DROP COLUMN "repo";
  CREATE UNIQUE INDEX "workspace_product_path_idx" ON "repo_instruction_files"
    USING btree ("workspace_id","product_id","path");`)
}
