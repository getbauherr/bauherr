import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "inbox_seen" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"user_id" integer NOT NULL,
  	"ticket_id" integer NOT NULL,
  	"need" varchar NOT NULL,
  	"since" varchar NOT NULL,
  	"seen_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "inbox_seen_id" integer;
  ALTER TABLE "inbox_seen" ADD CONSTRAINT "inbox_seen_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "inbox_seen" ADD CONSTRAINT "inbox_seen_user_id_bauherren_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "inbox_seen" ADD CONSTRAINT "inbox_seen_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_inbox_seen_fk" FOREIGN KEY ("inbox_seen_id") REFERENCES "public"."inbox_seen"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "inbox_seen_workspace_idx" ON "inbox_seen" USING btree ("workspace_id");
  CREATE INDEX "inbox_seen_user_idx" ON "inbox_seen" USING btree ("user_id");
  CREATE INDEX "inbox_seen_ticket_idx" ON "inbox_seen" USING btree ("ticket_id");
  CREATE INDEX "inbox_seen_updated_at_idx" ON "inbox_seen" USING btree ("updated_at");
  CREATE INDEX "inbox_seen_created_at_idx" ON "inbox_seen" USING btree ("created_at");
  CREATE UNIQUE INDEX "user_ticket_need_since_idx" ON "inbox_seen" USING btree ("user_id", "ticket_id", "need", "since");
  CREATE INDEX "payload_locked_documents_rels_inbox_seen_id_idx" ON "payload_locked_documents_rels" USING btree ("inbox_seen_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "inbox_seen_id";
  DROP TABLE "inbox_seen";`)
}
