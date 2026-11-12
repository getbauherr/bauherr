import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_bauherren_role" ADD VALUE IF NOT EXISTS 'product-owner';
  CREATE TYPE "public"."enum_bauherren_assignments_scope" AS ENUM('workspace', 'products');
  CREATE TABLE "bauherren_assignments" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"workspace_id" integer NOT NULL,
  	"scope" "enum_bauherren_assignments_scope" NOT NULL
  );
  CREATE TABLE "bauherren_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer
  );
  ALTER TABLE "bauherren_assignments" ADD CONSTRAINT "bauherren_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "bauherren_assignments" ADD CONSTRAINT "bauherren_assignments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "bauherren_rels" ADD CONSTRAINT "bauherren_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "bauherren_rels" ADD CONSTRAINT "bauherren_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "bauherren_assignments_order_idx" ON "bauherren_assignments" USING btree ("_order");
  CREATE INDEX "bauherren_assignments_parent_id_idx" ON "bauherren_assignments" USING btree ("_parent_id");
  CREATE INDEX "bauherren_assignments_workspace_idx" ON "bauherren_assignments" USING btree ("workspace_id");
  CREATE INDEX "bauherren_rels_order_idx" ON "bauherren_rels" USING btree ("order");
  CREATE INDEX "bauherren_rels_parent_idx" ON "bauherren_rels" USING btree ("parent_id");
  CREATE INDEX "bauherren_rels_path_idx" ON "bauherren_rels" USING btree ("path");
  CREATE INDEX "bauherren_rels_products_id_idx" ON "bauherren_rels" USING btree ("products_id");`)
}

/** Product owner accounts cannot exist without their role value: they are removed (the safe direction), then the enum is rebuilt without it. */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  DELETE FROM "bauherren" WHERE "role" = 'product-owner';
  DROP TABLE "bauherren_rels" CASCADE;
  DROP TABLE "bauherren_assignments" CASCADE;
  DROP TYPE "public"."enum_bauherren_assignments_scope";
  ALTER TABLE "bauherren" ALTER COLUMN "role" DROP DEFAULT;
  ALTER TABLE "bauherren" ALTER COLUMN "role" SET DATA TYPE text;
  DROP TYPE "public"."enum_bauherren_role";
  CREATE TYPE "public"."enum_bauherren_role" AS ENUM('admin', 'bauherr');
  ALTER TABLE "bauherren" ALTER COLUMN "role" SET DATA TYPE "public"."enum_bauherren_role" USING "role"::"public"."enum_bauherren_role";
  ALTER TABLE "bauherren" ALTER COLUMN "role" SET DEFAULT 'bauherr';`)
}
