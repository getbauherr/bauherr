import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  ALTER TYPE "public"."enum_runs_cost_source" ADD VALUE IF NOT EXISTS 'session-reported';`)
  await db.execute(sql`
  CREATE TYPE "public"."enum_usage_entries_source" AS ENUM('gateway', 'session-reported', 'chat');
  CREATE TABLE "usage_entries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"run_id" integer,
  	"session_id" integer,
  	"ticket_id" integer,
  	"stage" varchar,
  	"role" varchar,
  	"model" varchar DEFAULT 'unknown' NOT NULL,
  	"provider" varchar,
  	"tokens_in" numeric,
  	"tokens_out" numeric,
  	"cache_read" numeric,
  	"cache_write" numeric,
  	"cost_usd" numeric,
  	"source" "enum_usage_entries_source" NOT NULL,
  	"at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "usage_cursors" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"session_id" integer NOT NULL,
  	"claude_session" varchar NOT NULL,
  	"totals" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "usage_entries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "usage_cursors_id" integer;
  ALTER TABLE "usage_cursors" ADD CONSTRAINT "usage_cursors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_cursors" ADD CONSTRAINT "usage_cursors_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_usage_cursors_fk" FOREIGN KEY ("usage_cursors_id") REFERENCES "public"."usage_cursors"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "usage_cursors_workspace_idx" ON "usage_cursors" USING btree ("workspace_id");
  CREATE INDEX "usage_cursors_session_idx" ON "usage_cursors" USING btree ("session_id");
  CREATE INDEX "usage_cursors_updated_at_idx" ON "usage_cursors" USING btree ("updated_at");
  CREATE INDEX "usage_cursors_created_at_idx" ON "usage_cursors" USING btree ("created_at");
  CREATE UNIQUE INDEX "session_claude_session_idx" ON "usage_cursors" USING btree ("session_id", "claude_session");
  CREATE INDEX "payload_locked_documents_rels_usage_cursors_id_idx" ON "payload_locked_documents_rels" USING btree ("usage_cursors_id");
  ALTER TABLE "usage_entries" ADD CONSTRAINT "usage_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_entries" ADD CONSTRAINT "usage_entries_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_entries" ADD CONSTRAINT "usage_entries_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "usage_entries" ADD CONSTRAINT "usage_entries_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_usage_entries_fk" FOREIGN KEY ("usage_entries_id") REFERENCES "public"."usage_entries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "usage_entries_workspace_idx" ON "usage_entries" USING btree ("workspace_id");
  CREATE INDEX "usage_entries_run_idx" ON "usage_entries" USING btree ("run_id");
  CREATE INDEX "usage_entries_session_idx" ON "usage_entries" USING btree ("session_id");
  CREATE INDEX "usage_entries_ticket_idx" ON "usage_entries" USING btree ("ticket_id");
  CREATE INDEX "usage_entries_updated_at_idx" ON "usage_entries" USING btree ("updated_at");
  CREATE INDEX "usage_entries_created_at_idx" ON "usage_entries" USING btree ("created_at");
  CREATE UNIQUE INDEX "run_source_model_idx" ON "usage_entries" USING btree ("run_id", "source", "model");
  CREATE INDEX "workspace_source_at_idx" ON "usage_entries" USING btree ("workspace_id", "source", "at");
  CREATE INDEX "payload_locked_documents_rels_usage_entries_id_idx" ON "payload_locked_documents_rels" USING btree ("usage_entries_id");`)
  // Backfill: one gateway row per reconciled Run, one session-reported row per Run a session reported through the SDK estimate.
  await db.execute(sql`
  INSERT INTO "usage_entries" ("workspace_id", "run_id", "session_id", "ticket_id", "stage", "role", "model", "provider", "tokens_in", "tokens_out", "cost_usd", "source", "at")
  SELECT "workspace_id", "id", "session_id", "ticket_id", "stage", "role", COALESCE("model", 'unknown'), "provider", "gateway_tokens_in", "gateway_tokens_out", "gateway_cost_usd", 'gateway', COALESCE("finished_at", "created_at")
  FROM "runs" WHERE "cost_source" = 'gateway' AND "gateway_cost_usd" IS NOT NULL;`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "usage_cursors_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "usage_entries_id";
  DROP TABLE "usage_cursors";
  DROP TABLE "usage_entries";
  DROP TYPE "public"."enum_usage_entries_source";`)
}
