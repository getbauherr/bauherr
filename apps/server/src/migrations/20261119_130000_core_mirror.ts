import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const TABLES = sql`
  CREATE TABLE "mirror_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"source_id" integer NOT NULL,
  	"product_id" integer NOT NULL,
  	"repo" varchar NOT NULL,
  	"number" numeric NOT NULL,
  	"kind" varchar NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar,
  	"state" varchar NOT NULL,
  	"author" varchar,
  	"author_trusted" boolean DEFAULT false,
  	"author_is_bot" boolean DEFAULT false,
  	"labels" jsonb,
  	"assignees" jsonb,
  	"url" varchar,
  	"forge_created_at" timestamp(3) with time zone,
  	"forge_updated_at" timestamp(3) with time zone,
  	"forge_closed_at" timestamp(3) with time zone,
  	"head_sha" varchar,
  	"head_ref" varchar,
  	"closes" jsonb,
  	"draft" boolean DEFAULT false,
  	"synced_at" timestamp(3) with time zone,
  	"gone_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "mirror_comments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"item_id" integer NOT NULL,
  	"forge_id" varchar NOT NULL,
  	"author" varchar,
  	"body" varchar,
  	"forge_created_at" timestamp(3) with time zone,
  	"forge_updated_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "mirror_checks" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"item_id" integer NOT NULL,
  	"sha" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"status" varchar,
  	"conclusion" varchar,
  	"url" varchar,
  	"forge_updated_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "ticket_sources" ADD COLUMN "lookback_at" timestamp(3) with time zone;
  ALTER TABLE "ticket_sources" ADD COLUMN "reconciled_at" timestamp(3) with time zone;
  ALTER TABLE "ticket_sources" ADD COLUMN "imported_at" timestamp(3) with time zone;
  ALTER TABLE "products" ADD COLUMN "state" varchar DEFAULT 'observing' NOT NULL;
  ALTER TABLE "products" ADD COLUMN "connected_at" timestamp(3) with time zone;`

const LINKS = sql`
  ALTER TABLE "mirror_items" ADD CONSTRAINT "mirror_items_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "mirror_items" ADD CONSTRAINT "mirror_items_source_id_ticket_sources_id_fk"
    FOREIGN KEY ("source_id") REFERENCES "public"."ticket_sources"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "mirror_items" ADD CONSTRAINT "mirror_items_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "mirror_comments" ADD CONSTRAINT "mirror_comments_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "mirror_comments" ADD CONSTRAINT "mirror_comments_item_id_mirror_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."mirror_items"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "mirror_checks" ADD CONSTRAINT "mirror_checks_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "mirror_checks" ADD CONSTRAINT "mirror_checks_item_id_mirror_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "public"."mirror_items"("id") ON DELETE set null ON UPDATE no action;`

const INDEXES = sql`
  CREATE INDEX "mirror_items_workspace_idx" ON "mirror_items" USING btree ("workspace_id");
  CREATE INDEX "mirror_items_source_idx" ON "mirror_items" USING btree ("source_id");
  CREATE INDEX "mirror_items_product_idx" ON "mirror_items" USING btree ("product_id");
  CREATE INDEX "mirror_items_updated_at_idx" ON "mirror_items" USING btree ("updated_at");
  CREATE INDEX "mirror_items_created_at_idx" ON "mirror_items" USING btree ("created_at");
  CREATE UNIQUE INDEX "workspace_repo_number_idx" ON "mirror_items" USING btree ("workspace_id","repo","number");
  CREATE INDEX "mirror_comments_workspace_idx" ON "mirror_comments" USING btree ("workspace_id");
  CREATE INDEX "mirror_comments_item_idx" ON "mirror_comments" USING btree ("item_id");
  CREATE INDEX "mirror_comments_updated_at_idx" ON "mirror_comments" USING btree ("updated_at");
  CREATE INDEX "mirror_comments_created_at_idx" ON "mirror_comments" USING btree ("created_at");
  CREATE UNIQUE INDEX "item_forgeId_idx" ON "mirror_comments" USING btree ("item_id","forge_id");
  CREATE INDEX "mirror_checks_workspace_idx" ON "mirror_checks" USING btree ("workspace_id");
  CREATE INDEX "mirror_checks_item_idx" ON "mirror_checks" USING btree ("item_id");
  CREATE INDEX "mirror_checks_updated_at_idx" ON "mirror_checks" USING btree ("updated_at");
  CREATE INDEX "mirror_checks_created_at_idx" ON "mirror_checks" USING btree ("created_at");
  CREATE UNIQUE INDEX "item_sha_name_idx" ON "mirror_checks" USING btree ("item_id","sha","name");
  CREATE INDEX "mirror_items_fts_idx" ON "mirror_items"
    USING gin (to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("body", '')));`

const LOCKED = sql`
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "mirror_items_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "mirror_comments_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "mirror_checks_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_mirror_items_fk"
    FOREIGN KEY ("mirror_items_id") REFERENCES "public"."mirror_items"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_mirror_comments_fk"
    FOREIGN KEY ("mirror_comments_id") REFERENCES "public"."mirror_comments"("id")
    ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_mirror_checks_fk"
    FOREIGN KEY ("mirror_checks_id") REFERENCES "public"."mirror_checks"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_mirror_items_id_idx"
    ON "payload_locked_documents_rels" USING btree ("mirror_items_id");
  CREATE INDEX "payload_locked_documents_rels_mirror_comments_id_idx"
    ON "payload_locked_documents_rels" USING btree ("mirror_comments_id");
  CREATE INDEX "payload_locked_documents_rels_mirror_checks_id_idx"
    ON "payload_locked_documents_rels" USING btree ("mirror_checks_id");`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(TABLES)
  await db.execute(LINKS)
  await db.execute(INDEXES)
  await db.execute(LOCKED)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "mirror_items_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "mirror_comments_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "mirror_checks_id";
  DROP TABLE IF EXISTS "mirror_checks" CASCADE;
  DROP TABLE IF EXISTS "mirror_comments" CASCADE;
  DROP TABLE IF EXISTS "mirror_items" CASCADE;
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "lookback_at";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "reconciled_at";
  ALTER TABLE "ticket_sources" DROP COLUMN IF EXISTS "imported_at";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "state";
  ALTER TABLE "products" DROP COLUMN IF EXISTS "connected_at";`)
}
