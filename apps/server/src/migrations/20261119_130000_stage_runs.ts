import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const TABLE = sql`
   ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'expire-runs';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'expire-runs';
  ALTER TABLE "records" ADD COLUMN "card" jsonb;
  CREATE TABLE "stage_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"record_id" integer NOT NULL,
  	"stage" varchar NOT NULL,
  	"role" varchar NOT NULL,
  	"status" varchar NOT NULL,
  	"fingerprint" varchar NOT NULL,
  	"attempt" numeric DEFAULT 0 NOT NULL,
  	"lease_token_hash" varchar,
  	"leased_by" varchar,
  	"lease_expires_at" timestamp(3) with time zone,
  	"steps" jsonb NOT NULL,
  	"result" jsonb,
  	"error" varchar,
  	"cost_usd" numeric,
  	"started_at" timestamp(3) with time zone,
  	"finished_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );`

export const LIVE_RUN_INDEX = sql`
  CREATE UNIQUE INDEX IF NOT EXISTS "stage_runs_one_live_per_record_idx" ON "stage_runs"
    USING btree ("record_id") WHERE "status" IN ('queued', 'claimed');`

const LINKS = sql`
  ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
    ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stage_runs" ADD CONSTRAINT "stage_runs_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "public"."records"("id")
    ON DELETE set null ON UPDATE no action;
  CREATE INDEX "stage_runs_workspace_idx" ON "stage_runs"
    USING btree ("workspace_id");
  CREATE INDEX "stage_runs_record_idx" ON "stage_runs"
    USING btree ("record_id");
  CREATE INDEX "stage_runs_updated_at_idx" ON "stage_runs"
    USING btree ("updated_at");
  CREATE INDEX "stage_runs_created_at_idx" ON "stage_runs"
    USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stage_runs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stage_runs_fk"
    FOREIGN KEY ("stage_runs_id") REFERENCES "public"."stage_runs"("id")
    ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_stage_runs_id_idx" ON "payload_locked_documents_rels"
    USING btree ("stage_runs_id");`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(TABLE)
  await db.execute(LINKS)
  await db.execute(LIVE_RUN_INDEX)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "stage_runs_id";
  DROP TABLE IF EXISTS "stage_runs" CASCADE;
  ALTER TABLE "records" DROP COLUMN IF EXISTS "card";`)
}
