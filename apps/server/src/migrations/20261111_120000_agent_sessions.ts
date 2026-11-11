import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_agent_sessions_end_reason" AS ENUM('disconnect', 'timeout', 'replaced');
  CREATE TABLE "agent_sessions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"public_id" varchar NOT NULL,
  	"owner_id" integer,
  	"agent_key_id" integer,
  	"role" varchar NOT NULL,
  	"label" varchar,
  	"client_key" varchar,
  	"client_name" varchar,
  	"client_version" varchar,
  	"provider" varchar,
  	"model" varchar,
  	"connected_at" timestamp(3) with time zone,
  	"last_seen_at" timestamp(3) with time zone,
  	"disconnected_at" timestamp(3) with time zone,
  	"end_reason" "enum_agent_sessions_end_reason",
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  CREATE TABLE "session_spans" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"session_id" integer,
  	"run_id" integer,
  	"ticket_id" integer,
  	"started_at" timestamp(3) with time zone,
  	"last_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "runs" ADD COLUMN "session_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "agent_sessions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "session_spans_id" integer;
  ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_owner_id_bauherren_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."bauherren"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_agent_key_id_agent_keys_id_fk" FOREIGN KEY ("agent_key_id") REFERENCES "public"."agent_keys"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "session_spans" ADD CONSTRAINT "session_spans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "session_spans" ADD CONSTRAINT "session_spans_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "session_spans" ADD CONSTRAINT "session_spans_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "session_spans" ADD CONSTRAINT "session_spans_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_agent_sessions_fk" FOREIGN KEY ("agent_sessions_id") REFERENCES "public"."agent_sessions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_session_spans_fk" FOREIGN KEY ("session_spans_id") REFERENCES "public"."session_spans"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "agent_sessions_workspace_idx" ON "agent_sessions" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "agent_sessions_public_id_idx" ON "agent_sessions" USING btree ("public_id");
  CREATE INDEX "agent_sessions_owner_idx" ON "agent_sessions" USING btree ("owner_id");
  CREATE INDEX "agent_sessions_agent_key_idx" ON "agent_sessions" USING btree ("agent_key_id");
  CREATE INDEX "agent_sessions_updated_at_idx" ON "agent_sessions" USING btree ("updated_at");
  CREATE INDEX "agent_sessions_created_at_idx" ON "agent_sessions" USING btree ("created_at");
  CREATE INDEX "workspace_disconnected_at_idx" ON "agent_sessions" USING btree ("workspace_id", "disconnected_at");
  CREATE INDEX "last_seen_at_idx" ON "agent_sessions" USING btree ("last_seen_at");
  CREATE UNIQUE INDEX "workspace_owner_client_key_idx" ON "agent_sessions" USING btree ("workspace_id", "owner_id", "client_key");
  CREATE INDEX "session_spans_workspace_idx" ON "session_spans" USING btree ("workspace_id");
  CREATE INDEX "session_spans_session_idx" ON "session_spans" USING btree ("session_id");
  CREATE INDEX "session_spans_run_idx" ON "session_spans" USING btree ("run_id");
  CREATE INDEX "session_spans_ticket_idx" ON "session_spans" USING btree ("ticket_id");
  CREATE INDEX "session_spans_updated_at_idx" ON "session_spans" USING btree ("updated_at");
  CREATE INDEX "session_spans_created_at_idx" ON "session_spans" USING btree ("created_at");
  CREATE INDEX "session_started_at_idx" ON "session_spans" USING btree ("session_id", "started_at");
  CREATE INDEX "runs_session_idx" ON "runs" USING btree ("session_id");
  CREATE INDEX "payload_locked_documents_rels_agent_sessions_id_idx" ON "payload_locked_documents_rels" USING btree ("agent_sessions_id");
  CREATE INDEX "payload_locked_documents_rels_session_spans_id_idx" ON "payload_locked_documents_rels" USING btree ("session_spans_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "session_spans_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "agent_sessions_id";
  ALTER TABLE "runs" DROP COLUMN "session_id";
  DROP TABLE "session_spans";
  DROP TABLE "agent_sessions";
  DROP TYPE "public"."enum_agent_sessions_end_reason";`)
}
