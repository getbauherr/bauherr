import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "request_drafts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"conversation_id" integer NOT NULL,
  	"product_id" integer NOT NULL,
  	"state" varchar NOT NULL,
  	"data" jsonb NOT NULL,
  	"issue_number" numeric,
  	"record_id" integer,
  	"created_by" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "request_drafts" ADD CONSTRAINT "request_drafts_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "request_drafts" ADD CONSTRAINT "request_drafts_conversation_id_conversations_id_fk"
    FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "request_drafts" ADD CONSTRAINT "request_drafts_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "request_drafts" ADD CONSTRAINT "request_drafts_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "request_drafts_workspace_idx" ON "request_drafts" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "request_drafts_conversation_idx" ON "request_drafts" USING btree ("conversation_id");
  CREATE INDEX "request_drafts_product_idx" ON "request_drafts" USING btree ("product_id");
  CREATE INDEX "request_drafts_record_idx" ON "request_drafts" USING btree ("record_id");
  CREATE INDEX "request_drafts_updated_at_idx" ON "request_drafts" USING btree ("updated_at");
  CREATE INDEX "request_drafts_created_at_idx" ON "request_drafts" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "request_drafts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_request_drafts_fk"
    FOREIGN KEY ("request_drafts_id") REFERENCES "public"."request_drafts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_request_drafts_id_idx" ON "payload_locked_documents_rels"
    USING btree ("request_drafts_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "request_drafts_id";
  DROP TABLE IF EXISTS "request_drafts" CASCADE;`)
}
