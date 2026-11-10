import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_runs_stage" ADD VALUE IF NOT EXISTS 'distill';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE IF NOT EXISTS 'distill-skill';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE IF NOT EXISTS 'distill-skill';
  CREATE TYPE "public"."enum_skill_proposals_status" AS ENUM('proposed', 'replayed', 'accepted', 'rejected', 'skipped');
  CREATE TABLE "skill_proposals" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"ticket_id" integer NOT NULL,
  	"run_id" integer,
  	"status" "enum_skill_proposals_status" DEFAULT 'proposed' NOT NULL,
  	"pr" numeric,
  	"skill_path" varchar,
  	"score" numeric,
  	"baseline_score" numeric,
  	"results" jsonb,
  	"reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "skill_proposals_id" integer;
  ALTER TABLE "skill_proposals" ADD CONSTRAINT "skill_proposals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "skill_proposals" ADD CONSTRAINT "skill_proposals_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "skill_proposals" ADD CONSTRAINT "skill_proposals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "skill_proposals_workspace_idx" ON "skill_proposals" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "skill_proposals_ticket_idx" ON "skill_proposals" USING btree ("ticket_id");
  CREATE INDEX "skill_proposals_run_idx" ON "skill_proposals" USING btree ("run_id");
  CREATE INDEX "skill_proposals_updated_at_idx" ON "skill_proposals" USING btree ("updated_at");
  CREATE INDEX "skill_proposals_created_at_idx" ON "skill_proposals" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_skill_proposals_fk" FOREIGN KEY ("skill_proposals_id") REFERENCES "public"."skill_proposals"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_skill_proposals_id_idx" ON "payload_locked_documents_rels" USING btree ("skill_proposals_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "skill_proposals_id";
  DROP TABLE "skill_proposals";
  DROP TYPE "public"."enum_skill_proposals_status";`)
  // The enum values 'distill' (runs stage) and 'distill-skill' (job slugs) stay: Postgres cannot drop an enum value.
}
