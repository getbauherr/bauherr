import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "retros" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"range_from" timestamp(3) with time zone NOT NULL,
  	"range_to" timestamp(3) with time zone NOT NULL,
  	"range_label" varchar NOT NULL,
  	"state" varchar NOT NULL,
  	"agreed" jsonb NOT NULL,
  	"opening" jsonb,
  	"outcome" jsonb,
  	"created_by" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "retro_messages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"retro_id" integer NOT NULL,
  	"role" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"parts" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "retros" ADD CONSTRAINT "retros_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "retros" ADD CONSTRAINT "retros_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "retro_messages" ADD CONSTRAINT "retro_messages_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "retro_messages" ADD CONSTRAINT "retro_messages_retro_id_retros_id_fk"
    FOREIGN KEY ("retro_id") REFERENCES "public"."retros"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "retros_workspace_idx" ON "retros" USING btree ("workspace_id");
  CREATE INDEX "retros_product_idx" ON "retros" USING btree ("product_id");
  CREATE INDEX "retros_updated_at_idx" ON "retros" USING btree ("updated_at");
  CREATE INDEX "retros_created_at_idx" ON "retros" USING btree ("created_at");
  CREATE INDEX "retro_messages_workspace_idx" ON "retro_messages" USING btree ("workspace_id");
  CREATE INDEX "retro_messages_retro_idx" ON "retro_messages" USING btree ("retro_id");
  CREATE INDEX "retro_messages_updated_at_idx" ON "retro_messages" USING btree ("updated_at");
  CREATE INDEX "retro_messages_created_at_idx" ON "retro_messages" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "retros_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "retro_messages_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_retros_fk"
    FOREIGN KEY ("retros_id") REFERENCES "public"."retros"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_retro_messages_fk"
    FOREIGN KEY ("retro_messages_id") REFERENCES "public"."retro_messages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_retros_id_idx" ON "payload_locked_documents_rels"
    USING btree ("retros_id");
  CREATE INDEX "payload_locked_documents_rels_retro_messages_id_idx" ON "payload_locked_documents_rels"
    USING btree ("retro_messages_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "retros_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "retro_messages_id";
  DROP TABLE IF EXISTS "retro_messages" CASCADE;
  DROP TABLE IF EXISTS "retros" CASCADE;`)
}
