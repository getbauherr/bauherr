import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "release_notes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"version" varchar NOT NULL,
  	"items" jsonb NOT NULL,
  	"internal_count" numeric DEFAULT 0 NOT NULL,
  	"generated_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "release_notes" ADD CONSTRAINT "release_notes_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "release_notes" ADD CONSTRAINT "release_notes_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "release_notes_workspace_idx" ON "release_notes" USING btree ("workspace_id");
  CREATE INDEX "release_notes_product_idx" ON "release_notes" USING btree ("product_id");
  CREATE INDEX "release_notes_updated_at_idx" ON "release_notes" USING btree ("updated_at");
  CREATE INDEX "release_notes_created_at_idx" ON "release_notes" USING btree ("created_at");
  CREATE UNIQUE INDEX "product_version_idx" ON "release_notes" USING btree ("product_id","version");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "release_notes_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_release_notes_fk"
    FOREIGN KEY ("release_notes_id") REFERENCES "public"."release_notes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_release_notes_id_idx" ON "payload_locked_documents_rels"
    USING btree ("release_notes_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "release_notes_id";
  DROP TABLE IF EXISTS "release_notes" CASCADE;`)
}
