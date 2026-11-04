import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_check_flakes_outcome" AS ENUM('pending', 'flake', 'failed');
  CREATE TABLE "check_flakes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"ticket_id" integer NOT NULL,
  	"check_name" varchar NOT NULL,
  	"check_id" numeric,
  	"sha" varchar NOT NULL,
  	"run_url" varchar,
  	"outcome" "enum_check_flakes_outcome" DEFAULT 'pending' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "products" ADD COLUMN "check_retries" numeric DEFAULT 1;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "check_flakes_id" integer;
  ALTER TABLE "check_flakes" ADD CONSTRAINT "check_flakes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "check_flakes" ADD CONSTRAINT "check_flakes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "check_flakes_workspace_idx" ON "check_flakes" USING btree ("workspace_id");
  CREATE INDEX "check_flakes_ticket_idx" ON "check_flakes" USING btree ("ticket_id");
  CREATE INDEX "check_flakes_updated_at_idx" ON "check_flakes" USING btree ("updated_at");
  CREATE INDEX "check_flakes_created_at_idx" ON "check_flakes" USING btree ("created_at");
  CREATE UNIQUE INDEX "ticket_sha_check_name_idx" ON "check_flakes" USING btree ("ticket_id","sha","check_name");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_check_flakes_fk" FOREIGN KEY ("check_flakes_id") REFERENCES "public"."check_flakes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_check_flakes_id_idx" ON "payload_locked_documents_rels" USING btree ("check_flakes_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "check_flakes_id";
  ALTER TABLE "products" DROP COLUMN "check_retries";
  DROP TABLE "check_flakes";
  DROP TYPE "public"."enum_check_flakes_outcome";`)
}
