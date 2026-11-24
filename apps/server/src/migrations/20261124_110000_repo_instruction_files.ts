import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "repo_instruction_files" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"lines" numeric NOT NULL,
  	"chars" numeric NOT NULL,
  	"commit" varchar NOT NULL,
  	"synced_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "repo_instruction_files" ADD CONSTRAINT "repo_instruction_files_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "repo_instruction_files" ADD CONSTRAINT "repo_instruction_files_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "repo_instruction_files_workspace_idx" ON "repo_instruction_files" USING btree ("workspace_id");
  CREATE INDEX "repo_instruction_files_product_idx" ON "repo_instruction_files" USING btree ("product_id");
  CREATE INDEX "repo_instruction_files_updated_at_idx" ON "repo_instruction_files" USING btree ("updated_at");
  CREATE INDEX "repo_instruction_files_created_at_idx" ON "repo_instruction_files" USING btree ("created_at");
  CREATE UNIQUE INDEX "workspace_product_path_idx" ON "repo_instruction_files"
    USING btree ("workspace_id","product_id","path");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "repo_instruction_files_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_repo_instruction_files_fk"
    FOREIGN KEY ("repo_instruction_files_id") REFERENCES "public"."repo_instruction_files"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_repo_instruction_files_id_idx" ON "payload_locked_documents_rels"
    USING btree ("repo_instruction_files_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "repo_instruction_files_id";
  DROP TABLE IF EXISTS "repo_instruction_files" CASCADE;`)
}
