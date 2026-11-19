import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "proofs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"record_id" integer NOT NULL,
  	"criterion" varchar NOT NULL,
  	"kind" varchar NOT NULL,
  	"source" varchar NOT NULL,
  	"sha" varchar NOT NULL,
  	"body" varchar,
  	"url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "proofs" ADD CONSTRAINT "proofs_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "proofs" ADD CONSTRAINT "proofs_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "proofs_workspace_idx" ON "proofs"
    USING btree ("workspace_id");
  CREATE INDEX "proofs_record_idx" ON "proofs"
    USING btree ("record_id");
  CREATE INDEX "proofs_updated_at_idx" ON "proofs"
    USING btree ("updated_at");
  CREATE INDEX "proofs_created_at_idx" ON "proofs"
    USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "proofs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_proofs_fk"
    FOREIGN KEY ("proofs_id") REFERENCES "public"."proofs"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_proofs_id_idx" ON "payload_locked_documents_rels"
    USING btree ("proofs_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "proofs_id";
  DROP TABLE IF EXISTS "proofs" CASCADE;`)
}
