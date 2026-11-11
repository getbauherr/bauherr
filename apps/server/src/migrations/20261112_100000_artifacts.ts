import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_media_mime" ADD VALUE IF NOT EXISTS 'video/webm';
  ALTER TYPE "public"."enum_media_mime" ADD VALUE IF NOT EXISTS 'video/mp4';`)
  await db.execute(sql`
  CREATE TYPE "public"."enum_artifacts_kind" AS ENUM('image', 'recording', 'preview', 'transcript', 'sample', 'report');
  CREATE TYPE "public"."enum_artifacts_pair" AS ENUM('before', 'after');
  CREATE TABLE "artifacts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"ticket_id" integer NOT NULL,
  	"run_id" integer,
  	"kind" "enum_artifacts_kind" NOT NULL,
  	"title" varchar NOT NULL,
  	"criterion" varchar,
  	"rule" varchar,
  	"media_id" integer,
  	"url" varchar,
  	"text" varchar,
  	"pair" "enum_artifacts_pair",
  	"sha" varchar NOT NULL,
  	"waived" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "artifacts_id" integer;
  ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_artifacts_fk" FOREIGN KEY ("artifacts_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "artifacts_workspace_idx" ON "artifacts" USING btree ("workspace_id");
  CREATE INDEX "artifacts_ticket_idx" ON "artifacts" USING btree ("ticket_id");
  CREATE INDEX "artifacts_run_idx" ON "artifacts" USING btree ("run_id");
  CREATE INDEX "artifacts_media_idx" ON "artifacts" USING btree ("media_id");
  CREATE INDEX "artifacts_updated_at_idx" ON "artifacts" USING btree ("updated_at");
  CREATE INDEX "artifacts_created_at_idx" ON "artifacts" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_artifacts_id_idx" ON "payload_locked_documents_rels" USING btree ("artifacts_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "artifacts_id";
  DROP TABLE "artifacts";
  DROP TYPE "public"."enum_artifacts_pair";
  DROP TYPE "public"."enum_artifacts_kind";`)
}
