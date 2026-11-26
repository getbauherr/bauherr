import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TABLE "product_releases" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"product_id" integer NOT NULL,
  	"version" varchar NOT NULL,
  	"sha" varchar NOT NULL,
  	"state" varchar NOT NULL,
  	"steps" jsonb NOT NULL,
  	"body" varchar,
  	"tickets" jsonb NOT NULL,
  	"forge_release" varchar,
  	"failure" varchar,
  	"claimed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "product_releases" ADD CONSTRAINT "product_releases_product_id_products_id_fk"
    FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "product_releases_workspace_idx" ON "product_releases" USING btree ("workspace_id");
  CREATE INDEX "product_releases_product_idx" ON "product_releases" USING btree ("product_id");
  CREATE INDEX "product_releases_updated_at_idx" ON "product_releases" USING btree ("updated_at");
  CREATE INDEX "product_releases_created_at_idx" ON "product_releases" USING btree ("created_at");
  CREATE UNIQUE INDEX "version_product_idx" ON "product_releases" USING btree ("version","product_id");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "product_releases_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_product_releases_fk"
    FOREIGN KEY ("product_releases_id") REFERENCES "public"."product_releases"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_product_releases_id_idx" ON "payload_locked_documents_rels"
    USING btree ("product_releases_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "product_releases_id";
  DROP TABLE IF EXISTS "product_releases" CASCADE;`)
}
