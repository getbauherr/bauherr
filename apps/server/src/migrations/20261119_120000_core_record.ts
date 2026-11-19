import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const TABLES = sql`
   CREATE TABLE "records" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"source_forge" varchar NOT NULL,
  	"source_repo" varchar NOT NULL,
  	"source_number" numeric NOT NULL,
  	"stage" varchar NOT NULL,
  	"waiting_on" varchar NOT NULL,
  	"rank" numeric DEFAULT 0 NOT NULL,
  	"version" numeric DEFAULT 1 NOT NULL,
  	"data" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"record_id" integer NOT NULL,
  	"type" varchar NOT NULL,
  	"actor" varchar NOT NULL,
  	"actor_id" varchar,
  	"data" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );`

const LINKS = sql`
  ALTER TABLE "records" ADD CONSTRAINT "records_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "records" ADD CONSTRAINT "records_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "events" ADD CONSTRAINT "events_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "records_workspace_idx" ON "records"
    USING btree ("workspace_id");
  CREATE INDEX "records_product_idx" ON "records"
    USING btree ("product_id");
  CREATE INDEX "records_updated_at_idx" ON "records"
    USING btree ("updated_at");
  CREATE INDEX "records_created_at_idx" ON "records"
    USING btree ("created_at");
  CREATE UNIQUE INDEX "workspace_sourceForge_sourceRepo_sourceNumber_idx" ON "records"
    USING btree ("workspace_id","source_forge","source_repo","source_number");
  CREATE INDEX "events_workspace_idx" ON "events"
    USING btree ("workspace_id");
  CREATE INDEX "events_record_idx" ON "events"
    USING btree ("record_id");
  CREATE INDEX "events_updated_at_idx" ON "events"
    USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events"
    USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "records_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_records_fk"
    FOREIGN KEY ("records_id") REFERENCES "public"."records"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk"
    FOREIGN KEY ("events_id") REFERENCES "public"."events"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_records_id_idx" ON "payload_locked_documents_rels"
    USING btree ("records_id");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels"
    USING btree ("events_id");`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(TABLES)
  await db.execute(LINKS)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "records_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "events_id";
  DROP TABLE IF EXISTS "events" CASCADE;
  DROP TABLE IF EXISTS "records" CASCADE;`)
}
