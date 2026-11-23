import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "attachments" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"record_id" integer NOT NULL,
  	"run_id" integer NOT NULL,
  	"stage" varchar NOT NULL,
  	"kind" varchar NOT NULL,
  	"caption" varchar NOT NULL,
  	"content_type" varchar NOT NULL,
  	"byte_size" numeric,
  	"sha256" varchar,
  	"content" varchar,
  	"token_hash" varchar NOT NULL,
  	"lease_hash" varchar NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"criterion" varchar,
  	"proof_sha" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "proofs" ADD COLUMN "attachment_id" integer;
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "attachments" ADD CONSTRAINT "attachments_run_id_stage_runs_id_fk"
    FOREIGN KEY ("run_id") REFERENCES "public"."stage_runs"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "proofs" ADD CONSTRAINT "proofs_attachment_id_attachments_id_fk"
    FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "proofs_attachment_idx" ON "proofs"
    USING btree ("attachment_id");
  CREATE INDEX "attachments_workspace_idx" ON "attachments"
    USING btree ("workspace_id");
  CREATE INDEX "attachments_record_idx" ON "attachments"
    USING btree ("record_id");
  CREATE INDEX "attachments_run_idx" ON "attachments"
    USING btree ("run_id");
  CREATE UNIQUE INDEX "attachments_token_hash_idx" ON "attachments"
    USING btree ("token_hash");
  CREATE INDEX "attachments_updated_at_idx" ON "attachments"
    USING btree ("updated_at");
  CREATE INDEX "attachments_created_at_idx" ON "attachments"
    USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "attachments_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_attachments_fk"
    FOREIGN KEY ("attachments_id") REFERENCES "public"."attachments"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_attachments_id_idx" ON "payload_locked_documents_rels"
    USING btree ("attachments_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "attachments_id";
  ALTER TABLE "proofs" DROP COLUMN IF EXISTS "attachment_id";
  DROP TABLE IF EXISTS "attachments" CASCADE;`)
}
