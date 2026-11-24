import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "repo_instruction_files" DROP CONSTRAINT "repo_instruction_files_workspace_id_workspaces_id_fk";
  ALTER TABLE "repo_instruction_files" ADD CONSTRAINT "repo_instruction_files_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "repo_instruction_files" DROP CONSTRAINT "repo_instruction_files_workspace_id_workspaces_id_fk";
  ALTER TABLE "repo_instruction_files" ADD CONSTRAINT "repo_instruction_files_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;`)
}
