import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_knowledge_chunks_layer" AS ENUM('core', 'workspace', 'product');
  CREATE TABLE "knowledge_chunks" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"source" varchar NOT NULL,
  	"layer" "enum_knowledge_chunks_layer" NOT NULL,
  	"path" varchar NOT NULL,
  	"logical" varchar NOT NULL,
  	"product" varchar,
  	"heading" varchar,
  	"text" varchar NOT NULL,
  	"commit" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "workspaces" ADD COLUMN "knowledge_connection_id" integer;
  ALTER TABLE "workspaces" ADD COLUMN "knowledge_repo" varchar;
  ALTER TABLE "workspaces" ADD COLUMN "knowledge_indexed" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "knowledge_chunks_id" integer;
  ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_knowledge_connection_id_connections_id_fk" FOREIGN KEY ("knowledge_connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_knowledge_chunks_fk" FOREIGN KEY ("knowledge_chunks_id") REFERENCES "public"."knowledge_chunks"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "knowledge_chunks_workspace_idx" ON "knowledge_chunks" USING btree ("workspace_id");
  CREATE INDEX "knowledge_chunks_source_idx" ON "knowledge_chunks" USING btree ("source");
  CREATE INDEX "knowledge_chunks_logical_idx" ON "knowledge_chunks" USING btree ("logical");
  CREATE INDEX "knowledge_chunks_updated_at_idx" ON "knowledge_chunks" USING btree ("updated_at");
  CREATE INDEX "knowledge_chunks_created_at_idx" ON "knowledge_chunks" USING btree ("created_at");
  CREATE INDEX "workspaces_knowledge_connection_idx" ON "workspaces" USING btree ("knowledge_connection_id");
  CREATE INDEX "payload_locked_documents_rels_knowledge_chunks_id_idx" ON "payload_locked_documents_rels" USING btree ("knowledge_chunks_id");
  CREATE INDEX "knowledge_chunks_fts_idx" ON "knowledge_chunks" USING gin (to_tsvector('simple', coalesce("heading", '') || ' ' || coalesce("text", '')));`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "knowledge_chunks_id";
  ALTER TABLE "workspaces" DROP COLUMN "knowledge_connection_id";
  ALTER TABLE "workspaces" DROP COLUMN "knowledge_repo";
  ALTER TABLE "workspaces" DROP COLUMN "knowledge_indexed";
  DROP TABLE "knowledge_chunks" CASCADE;
  DROP TYPE "public"."enum_knowledge_chunks_layer";`)
}
