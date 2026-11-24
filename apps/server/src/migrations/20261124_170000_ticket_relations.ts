import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "ticket_relations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"from_item_id" integer NOT NULL,
  	"to_item_id" integer NOT NULL,
  	"type" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_from_item_id_mirror_items_id_fk"
    FOREIGN KEY ("from_item_id") REFERENCES "public"."mirror_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "ticket_relations" ADD CONSTRAINT "ticket_relations_to_item_id_mirror_items_id_fk"
    FOREIGN KEY ("to_item_id") REFERENCES "public"."mirror_items"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "ticket_relations_workspace_idx" ON "ticket_relations" USING btree ("workspace_id");
  CREATE INDEX "ticket_relations_from_item_idx" ON "ticket_relations" USING btree ("from_item_id");
  CREATE INDEX "ticket_relations_to_item_idx" ON "ticket_relations" USING btree ("to_item_id");
  CREATE INDEX "ticket_relations_updated_at_idx" ON "ticket_relations" USING btree ("updated_at");
  CREATE INDEX "ticket_relations_created_at_idx" ON "ticket_relations" USING btree ("created_at");
  CREATE UNIQUE INDEX "fromItem_toItem_type_idx" ON "ticket_relations"
    USING btree ("from_item_id","to_item_id","type");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ticket_relations_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ticket_relations_fk"
    FOREIGN KEY ("ticket_relations_id") REFERENCES "public"."ticket_relations"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ticket_relations_id_idx" ON "payload_locked_documents_rels"
    USING btree ("ticket_relations_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "ticket_relations_id";
  DROP TABLE IF EXISTS "ticket_relations" CASCADE;`)
}
