import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "memory_document_versions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer,
  	"scope" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"author" varchar NOT NULL,
  	"reason" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "memory_document_versions" ADD CONSTRAINT "memory_document_versions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "memory_document_versions" ADD CONSTRAINT "memory_document_versions_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "memory_document_versions_workspace_idx" ON "memory_document_versions"
    USING btree ("workspace_id");
  CREATE INDEX "memory_document_versions_product_idx" ON "memory_document_versions"
    USING btree ("product_id");
  CREATE INDEX "memory_document_versions_updated_at_idx" ON "memory_document_versions"
    USING btree ("updated_at");
  CREATE INDEX "memory_document_versions_created_at_idx" ON "memory_document_versions"
    USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "memory_document_versions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_memory_document_versions_fk"
    FOREIGN KEY ("memory_document_versions_id") REFERENCES "public"."memory_document_versions"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_memory_document_versions_i_idx" ON "payload_locked_documents_rels"
    USING btree ("memory_document_versions_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "memory_document_versions_id";
  DROP TABLE IF EXISTS "memory_document_versions" CASCADE;`)
}
