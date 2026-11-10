import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
  CREATE TYPE "public"."enum_ticket_events_phase" AS ENUM('working', 'queued', 'human', 'ci', 'closed');
  CREATE TYPE "public"."enum_ticket_events_executor" AS ENUM('session', 'runner', 'ci', 'human', 'factory');
  CREATE TABLE "ticket_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"ticket_id" integer,
  	"at" timestamp(3) with time zone NOT NULL,
  	"stage" varchar,
  	"stage_kind" varchar,
  	"phase" "enum_ticket_events_phase" NOT NULL,
  	"from_stage" varchar,
  	"outcome" varchar,
  	"run_id" integer,
  	"executor" "enum_ticket_events_executor",
  	"actor" varchar,
  	"cause" varchar,
  	"workflow_version" numeric,
  	"backfilled" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  ALTER TABLE "tickets" ADD COLUMN "history_key" varchar;
  ALTER TABLE "runs" ADD COLUMN "executor" varchar;
  ALTER TABLE "runs" ADD COLUMN "role" varchar;
  ALTER TABLE "runs" ADD COLUMN "client_name" varchar;
  ALTER TABLE "runs" ADD COLUMN "client_version" varchar;
  ALTER TABLE "runs" ADD COLUMN "provider" varchar;
  ALTER TABLE "runs" ADD COLUMN "outcome" varchar;
  ALTER TABLE "steps" ADD COLUMN "finished_at" timestamp(3) with time zone;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ticket_events_id" integer;
  ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "ticket_events_workspace_idx" ON "ticket_events" USING btree ("workspace_id");
  CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" USING btree ("ticket_id");
  CREATE INDEX "ticket_events_run_idx" ON "ticket_events" USING btree ("run_id");
  CREATE INDEX "ticket_events_updated_at_idx" ON "ticket_events" USING btree ("updated_at");
  CREATE INDEX "ticket_events_created_at_idx" ON "ticket_events" USING btree ("created_at");
  CREATE INDEX "ticket_at_idx" ON "ticket_events" USING btree ("ticket_id", "at");
  CREATE INDEX "workspace_at_idx" ON "ticket_events" USING btree ("workspace_id", "at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ticket_events_fk" FOREIGN KEY ("ticket_events_id") REFERENCES "public"."ticket_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ticket_events_id_idx" ON "payload_locked_documents_rels" USING btree ("ticket_events_id");`)

  // Best-effort backfill from Runs and human touches; stage names are the default pack's (triage, plan, release, done).
  // 1. a Ticket's creation.
  await db.execute(sql`
  INSERT INTO "ticket_events" ("workspace_id", "ticket_id", "at", "stage", "stage_kind", "phase", "executor", "cause", "backfilled")
  SELECT "workspace_id", "id", "created_at", 'triage', 'triage', 'queued', 'factory', 'backfill:created', true FROM "tickets";
  INSERT INTO "ticket_events" ("workspace_id", "ticket_id", "at", "stage", "stage_kind", "phase", "run_id", "executor", "actor", "cause", "backfilled")
  SELECT r."workspace_id", r."ticket_id", e."at", r."stage", r."kind", e."phase"::"enum_ticket_events_phase", r."id", CASE WHEN r."mode" = 'session' THEN 'session' ELSE 'runner' END::"enum_ticket_events_executor", r."session_label", e."cause", true
  FROM "runs" r
  CROSS JOIN LATERAL (VALUES (r."created_at", 'queued', 'backfill:run:created'), (r."started_at", 'working', 'backfill:run:started'), (r."finished_at", 'queued', 'backfill:run:finished')) AS e("at", "phase", "cause")
  WHERE e."at" IS NOT NULL AND r."ticket_id" IS NOT NULL AND r."stage" NOT IN ('scan', 'distill');
  INSERT INTO "ticket_events" ("workspace_id", "ticket_id", "at", "stage", "stage_kind", "phase", "executor", "actor", "cause", "backfilled")
  SELECT h."workspace_id", h."ticket_id", p."waiting_since", p."stage", p."stage", 'human', 'human', NULL, 'backfill:waiting', true
  FROM "human_touches" h
  CROSS JOIN LATERAL (SELECT CASE WHEN h."kind" = 'approve:plan' THEN 'plan' ELSE 'release' END AS "stage") s
  CROSS JOIN LATERAL (SELECT s."stage", (SELECT max(r."finished_at") FROM "runs" r WHERE r."ticket_id" = h."ticket_id" AND r."stage" = s."stage" AND r."finished_at" <= h."at") AS "waiting_since") p
  WHERE h."kind" IN ('approve:plan', 'accept:staging', 'approve:production') AND h."ticket_id" IS NOT NULL AND h."at" IS NOT NULL AND p."waiting_since" IS NOT NULL;
  INSERT INTO "ticket_events" ("workspace_id", "ticket_id", "at", "stage", "stage_kind", "phase", "executor", "actor", "cause", "backfilled")
  SELECT h."workspace_id", h."ticket_id", h."at", CASE WHEN h."kind" = 'approve:plan' THEN 'plan' ELSE 'release' END, CASE WHEN h."kind" = 'approve:plan' THEN 'plan' ELSE 'release' END, 'queued', 'human', h."actor", 'gate:' || h."kind", true
  FROM "human_touches" h
  WHERE h."kind" IN ('approve:plan', 'accept:staging', 'approve:production') AND h."ticket_id" IS NOT NULL AND h."at" IS NOT NULL;
  INSERT INTO "ticket_events" ("workspace_id", "ticket_id", "at", "stage", "stage_kind", "phase", "executor", "cause", "backfilled")
  SELECT t."workspace_id", t."id", GREATEST(LEAST(t."updated_at", COALESCE(t."release_published_at", t."updated_at")), COALESCE((SELECT max(e."at") FROM "ticket_events" e WHERE e."ticket_id" = t."id"), t."created_at")), 'done', 'done', 'closed', 'factory', 'backfill:closed', true
  FROM "tickets" t WHERE t."state" = 'closed';`)
  // 2. order the rows, drop consecutive duplicates (same stage and phase), fill from_stage and the Ticket's history key.
  await db.execute(sql`
  DELETE FROM "ticket_events" WHERE "id" IN (
    SELECT "id" FROM (SELECT "id", "stage", "phase", LAG("stage") OVER w AS "prev_stage", LAG("phase") OVER w AS "prev_phase" FROM "ticket_events" WINDOW w AS (PARTITION BY "ticket_id" ORDER BY "at", "id")) x
    WHERE "stage" IS NOT DISTINCT FROM "prev_stage" AND "phase" = "prev_phase");
  UPDATE "ticket_events" e SET "from_stage" = x."prev_stage" FROM (SELECT "id", LAG("stage") OVER (PARTITION BY "ticket_id" ORDER BY "at", "id") AS "prev_stage" FROM "ticket_events") x WHERE e."id" = x."id" AND x."prev_stage" IS DISTINCT FROM e."stage";
  UPDATE "tickets" t SET "history_key" = COALESCE(n."stage", '') || '|' || n."phase" FROM (SELECT DISTINCT ON ("ticket_id") "ticket_id", "stage", "phase" FROM "ticket_events" ORDER BY "ticket_id", "at" DESC, "id" DESC) n WHERE n."ticket_id" = t."id";`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ticket_events_id";
  DROP TABLE "ticket_events";
  DROP TYPE "public"."enum_ticket_events_phase";
  DROP TYPE "public"."enum_ticket_events_executor";
  ALTER TABLE "tickets" DROP COLUMN "history_key";
  ALTER TABLE "runs" DROP COLUMN "executor", DROP COLUMN "role", DROP COLUMN "client_name", DROP COLUMN "client_version", DROP COLUMN "provider", DROP COLUMN "outcome";
  ALTER TABLE "steps" DROP COLUMN "finished_at";`)
}
