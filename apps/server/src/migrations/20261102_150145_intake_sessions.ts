import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_intake_sessions_persona" AS ENUM('product-user', 'owner');
  CREATE TYPE "public"."enum_intake_sessions_status" AS ENUM('open', 'submitted', 'abandoned');
  CREATE TABLE "intake_sessions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"persona" "enum_intake_sessions_persona" DEFAULT 'product-user' NOT NULL,
  	"status" "enum_intake_sessions_status" DEFAULT 'open' NOT NULL,
  	"messages" jsonb,
  	"draft" jsonb,
  	"screenshots" numeric DEFAULT 0,
  	"ticket_number" numeric,
  	"ip" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "intake_sessions_id" integer;
  ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "intake_sessions" ADD CONSTRAINT "intake_sessions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_intake_sessions_fk" FOREIGN KEY ("intake_sessions_id") REFERENCES "public"."intake_sessions"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "intake_sessions_workspace_idx" ON "intake_sessions" USING btree ("workspace_id");
  CREATE INDEX "intake_sessions_product_idx" ON "intake_sessions" USING btree ("product_id");
  CREATE INDEX "intake_sessions_status_idx" ON "intake_sessions" USING btree ("status");
  CREATE INDEX "intake_sessions_ip_idx" ON "intake_sessions" USING btree ("ip");
  CREATE INDEX "intake_sessions_updated_at_idx" ON "intake_sessions" USING btree ("updated_at");
  CREATE INDEX "intake_sessions_created_at_idx" ON "intake_sessions" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_intake_sessions_id_idx" ON "payload_locked_documents_rels" USING btree ("intake_sessions_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "intake_sessions_id";
  DROP TABLE "intake_sessions" CASCADE;
  DROP TYPE "public"."enum_intake_sessions_persona";
  DROP TYPE "public"."enum_intake_sessions_status";`)
}
