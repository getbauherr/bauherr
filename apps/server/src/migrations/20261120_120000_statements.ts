import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "statements" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"record_id" integer NOT NULL,
  	"kind" varchar NOT NULL,
  	"text" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "statements" ADD CONSTRAINT "statements_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "statements" ADD CONSTRAINT "statements_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "statements" ADD CONSTRAINT "statements_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "statements_workspace_idx" ON "statements"
    USING btree ("workspace_id");
  CREATE INDEX "statements_product_idx" ON "statements"
    USING btree ("product_id");
  CREATE INDEX "statements_record_idx" ON "statements"
    USING btree ("record_id");
  CREATE INDEX "statements_updated_at_idx" ON "statements"
    USING btree ("updated_at");
  CREATE INDEX "statements_created_at_idx" ON "statements"
    USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "statements_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_statements_fk"
    FOREIGN KEY ("statements_id") REFERENCES "public"."statements"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_statements_id_idx" ON "payload_locked_documents_rels"
    USING btree ("statements_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "statements_id";
  DROP TABLE IF EXISTS "statements" CASCADE;`)
}
