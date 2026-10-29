import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_bauherren_role" AS ENUM('admin', 'bauherr');
  CREATE TYPE "public"."enum_workspaces_default_mode" AS ENUM('session', 'autonomous');
  CREATE TYPE "public"."enum_connections_kind" AS ENUM('github', 'llm-provider');
  CREATE TYPE "public"."enum_tickets_state" AS ENUM('open', 'closed');
  CREATE TYPE "public"."enum_runs_stage" AS ENUM('plan', 'build');
  CREATE TYPE "public"."enum_runs_status" AS ENUM('queued', 'awaiting_session', 'running', 'succeeded', 'failed', 'cancelled', 'needs_human', 'budget_exhausted');
  CREATE TYPE "public"."enum_runs_mode" AS ENUM('session', 'autonomous');
  CREATE TYPE "public"."enum_runs_cost_source" AS ENUM('estimate', 'gateway');
  CREATE TYPE "public"."enum_runs_reconcile_status" AS ENUM('pending', 'matched', 'mismatch');
  CREATE TYPE "public"."enum_tool_calls_status" AS ENUM('ok', 'error');
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'poll-tickets', 'run-stage', 'expire-sessions');
  CREATE TYPE "public"."enum_payload_jobs_log_state" AS ENUM('failed', 'succeeded');
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'poll-tickets', 'run-stage', 'expire-sessions');
  CREATE TABLE "bauherren_tenants" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"tenant_id" integer NOT NULL
  );
  
  CREATE TABLE "bauherren_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "bauherren" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"role" "enum_bauherren_role" DEFAULT 'bauherr' NOT NULL,
  	"github_login" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"enable_a_p_i_key" boolean,
  	"api_key" varchar,
  	"api_key_index" varchar,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"reset_password_requested_at" timestamp(3) with time zone,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "workspaces" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"gateway_key" varchar,
  	"budget_usd30d" numeric DEFAULT 50,
  	"model_by_tier" jsonb DEFAULT '{"cheap":"claude-haiku-5-5","standard":"claude-sonnet-5-5","strong":"claude-opus-5-5"}'::jsonb,
  	"default_mode" "enum_workspaces_default_mode",
  	"mode_by_stage" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "connections" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"name" varchar NOT NULL,
  	"kind" "enum_connections_kind" NOT NULL,
  	"config" jsonb,
  	"secret" varchar,
  	"capabilities" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "repositories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"full_name" varchar NOT NULL,
  	"product_id" integer NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ticket_sources" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"repo" varchar NOT NULL,
  	"product_id" integer NOT NULL,
  	"connection_id" integer NOT NULL,
  	"cursor" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tickets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"title" varchar NOT NULL,
  	"product_id" integer NOT NULL,
  	"external_id" varchar NOT NULL,
  	"number" numeric,
  	"url" varchar,
  	"state" "enum_tickets_state",
  	"assignee" varchar,
  	"source_updated_at" timestamp(3) with time zone,
  	"stage" varchar,
  	"parent_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tickets_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "tickets_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"tickets_id" integer
  );
  
  CREATE TABLE "runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"ticket_id" integer NOT NULL,
  	"stage" "enum_runs_stage" NOT NULL,
  	"status" "enum_runs_status" DEFAULT 'queued' NOT NULL,
  	"mode" "enum_runs_mode" DEFAULT 'autonomous' NOT NULL,
  	"session_owner_id" integer,
  	"heartbeat_at" timestamp(3) with time zone,
  	"evidence" varchar,
  	"goal" jsonb,
  	"model" varchar,
  	"tokens_in" numeric,
  	"tokens_out" numeric,
  	"tokens_cache" numeric,
  	"cost_estimate_usd" numeric,
  	"gateway_cost_usd" numeric,
  	"cost_source" "enum_runs_cost_source" DEFAULT 'estimate',
  	"reconcile_status" "enum_runs_reconcile_status" DEFAULT 'pending',
  	"started_at" timestamp(3) with time zone,
  	"finished_at" timestamp(3) with time zone,
  	"error" varchar,
  	"artifacts" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "steps" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"run_id" integer NOT NULL,
  	"seq" numeric,
  	"message_id" varchar,
  	"tokens_in" numeric,
  	"tokens_out" numeric,
  	"cost_estimate_usd" numeric,
  	"started_at" timestamp(3) with time zone,
  	"summary" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tool_calls" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"tool_use_id" varchar,
  	"step_id" integer,
  	"run_id" integer,
  	"name" varchar,
  	"input_digest" varchar,
  	"status" "enum_tool_calls_status",
  	"duration_ms" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "human_touches" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"kind" varchar,
  	"ticket_id" integer NOT NULL,
  	"run_id" integer,
  	"actor" varchar,
  	"at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "workflow_versions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer,
  	"version" numeric,
  	"product_id" integer NOT NULL,
  	"compiled" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_jobs_log" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"executed_at" timestamp(3) with time zone NOT NULL,
  	"completed_at" timestamp(3) with time zone NOT NULL,
  	"task_slug" "enum_payload_jobs_log_task_slug" NOT NULL,
  	"task_i_d" varchar NOT NULL,
  	"input" jsonb,
  	"output" jsonb,
  	"state" "enum_payload_jobs_log_state" NOT NULL,
  	"error" jsonb
  );
  
  CREATE TABLE "payload_jobs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"input" jsonb,
  	"completed_at" timestamp(3) with time zone,
  	"total_tried" numeric DEFAULT 0,
  	"has_error" boolean DEFAULT false,
  	"error" jsonb,
  	"task_slug" "enum_payload_jobs_task_slug",
  	"queue" varchar DEFAULT 'default',
  	"wait_until" timestamp(3) with time zone,
  	"processing" boolean DEFAULT false,
  	"concurrency_key" varchar,
  	"meta" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"bauherren_id" integer,
  	"workspaces_id" integer,
  	"products_id" integer,
  	"connections_id" integer,
  	"repositories_id" integer,
  	"ticket_sources_id" integer,
  	"tickets_id" integer,
  	"runs_id" integer,
  	"steps_id" integer,
  	"tool_calls_id" integer,
  	"human_touches_id" integer,
  	"workflow_versions_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"bauherren_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_jobs_stats" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"stats" jsonb,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "bauherren_tenants" ADD CONSTRAINT "bauherren_tenants_tenant_id_workspaces_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "bauherren_tenants" ADD CONSTRAINT "bauherren_tenants_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "bauherren_sessions" ADD CONSTRAINT "bauherren_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "repositories" ADD CONSTRAINT "repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "repositories" ADD CONSTRAINT "repositories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_sources" ADD CONSTRAINT "ticket_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_sources" ADD CONSTRAINT "ticket_sources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "ticket_sources" ADD CONSTRAINT "ticket_sources_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_parent_id_tickets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets_texts" ADD CONSTRAINT "tickets_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tickets_rels" ADD CONSTRAINT "tickets_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tickets_rels" ADD CONSTRAINT "tickets_rels_tickets_fk" FOREIGN KEY ("tickets_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "runs" ADD CONSTRAINT "runs_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "runs" ADD CONSTRAINT "runs_session_owner_id_bauherren_id_fk" FOREIGN KEY ("session_owner_id") REFERENCES "public"."bauherren"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "steps" ADD CONSTRAINT "steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "steps" ADD CONSTRAINT "steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_step_id_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."steps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "human_touches" ADD CONSTRAINT "human_touches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "human_touches" ADD CONSTRAINT "human_touches_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "human_touches" ADD CONSTRAINT "human_touches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_jobs_log" ADD CONSTRAINT "payload_jobs_log_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."payload_jobs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_bauherren_fk" FOREIGN KEY ("bauherren_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_workspaces_fk" FOREIGN KEY ("workspaces_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_connections_fk" FOREIGN KEY ("connections_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_repositories_fk" FOREIGN KEY ("repositories_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ticket_sources_fk" FOREIGN KEY ("ticket_sources_id") REFERENCES "public"."ticket_sources"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tickets_fk" FOREIGN KEY ("tickets_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_runs_fk" FOREIGN KEY ("runs_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_steps_fk" FOREIGN KEY ("steps_id") REFERENCES "public"."steps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tool_calls_fk" FOREIGN KEY ("tool_calls_id") REFERENCES "public"."tool_calls"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_human_touches_fk" FOREIGN KEY ("human_touches_id") REFERENCES "public"."human_touches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_workflow_versions_fk" FOREIGN KEY ("workflow_versions_id") REFERENCES "public"."workflow_versions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_bauherren_fk" FOREIGN KEY ("bauherren_id") REFERENCES "public"."bauherren"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "bauherren_tenants_order_idx" ON "bauherren_tenants" USING btree ("_order");
  CREATE INDEX "bauherren_tenants_parent_id_idx" ON "bauherren_tenants" USING btree ("_parent_id");
  CREATE INDEX "bauherren_tenants_tenant_idx" ON "bauherren_tenants" USING btree ("tenant_id");
  CREATE INDEX "bauherren_sessions_order_idx" ON "bauherren_sessions" USING btree ("_order");
  CREATE INDEX "bauherren_sessions_parent_id_idx" ON "bauherren_sessions" USING btree ("_parent_id");
  CREATE INDEX "bauherren_updated_at_idx" ON "bauherren" USING btree ("updated_at");
  CREATE INDEX "bauherren_created_at_idx" ON "bauherren" USING btree ("created_at");
  CREATE UNIQUE INDEX "bauherren_email_idx" ON "bauherren" USING btree ("email");
  CREATE UNIQUE INDEX "workspaces_slug_idx" ON "workspaces" USING btree ("slug");
  CREATE INDEX "workspaces_updated_at_idx" ON "workspaces" USING btree ("updated_at");
  CREATE INDEX "workspaces_created_at_idx" ON "workspaces" USING btree ("created_at");
  CREATE INDEX "products_workspace_idx" ON "products" USING btree ("workspace_id");
  CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");
  CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");
  CREATE INDEX "connections_workspace_idx" ON "connections" USING btree ("workspace_id");
  CREATE INDEX "connections_updated_at_idx" ON "connections" USING btree ("updated_at");
  CREATE INDEX "connections_created_at_idx" ON "connections" USING btree ("created_at");
  CREATE INDEX "repositories_workspace_idx" ON "repositories" USING btree ("workspace_id");
  CREATE INDEX "repositories_product_idx" ON "repositories" USING btree ("product_id");
  CREATE INDEX "repositories_updated_at_idx" ON "repositories" USING btree ("updated_at");
  CREATE INDEX "repositories_created_at_idx" ON "repositories" USING btree ("created_at");
  CREATE INDEX "ticket_sources_workspace_idx" ON "ticket_sources" USING btree ("workspace_id");
  CREATE INDEX "ticket_sources_product_idx" ON "ticket_sources" USING btree ("product_id");
  CREATE INDEX "ticket_sources_connection_idx" ON "ticket_sources" USING btree ("connection_id");
  CREATE INDEX "ticket_sources_updated_at_idx" ON "ticket_sources" USING btree ("updated_at");
  CREATE INDEX "ticket_sources_created_at_idx" ON "ticket_sources" USING btree ("created_at");
  CREATE INDEX "tickets_workspace_idx" ON "tickets" USING btree ("workspace_id");
  CREATE INDEX "tickets_product_idx" ON "tickets" USING btree ("product_id");
  CREATE INDEX "tickets_external_id_idx" ON "tickets" USING btree ("external_id");
  CREATE INDEX "tickets_stage_idx" ON "tickets" USING btree ("stage");
  CREATE INDEX "tickets_parent_idx" ON "tickets" USING btree ("parent_id");
  CREATE INDEX "tickets_updated_at_idx" ON "tickets" USING btree ("updated_at");
  CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");
  CREATE INDEX "tickets_texts_order_parent" ON "tickets_texts" USING btree ("order","parent_id");
  CREATE INDEX "tickets_rels_order_idx" ON "tickets_rels" USING btree ("order");
  CREATE INDEX "tickets_rels_parent_idx" ON "tickets_rels" USING btree ("parent_id");
  CREATE INDEX "tickets_rels_path_idx" ON "tickets_rels" USING btree ("path");
  CREATE INDEX "tickets_rels_tickets_id_idx" ON "tickets_rels" USING btree ("tickets_id");
  CREATE INDEX "runs_workspace_idx" ON "runs" USING btree ("workspace_id");
  CREATE INDEX "runs_ticket_idx" ON "runs" USING btree ("ticket_id");
  CREATE INDEX "runs_session_owner_idx" ON "runs" USING btree ("session_owner_id");
  CREATE INDEX "runs_updated_at_idx" ON "runs" USING btree ("updated_at");
  CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");
  CREATE INDEX "steps_workspace_idx" ON "steps" USING btree ("workspace_id");
  CREATE INDEX "steps_run_idx" ON "steps" USING btree ("run_id");
  CREATE INDEX "steps_updated_at_idx" ON "steps" USING btree ("updated_at");
  CREATE INDEX "steps_created_at_idx" ON "steps" USING btree ("created_at");
  CREATE INDEX "tool_calls_workspace_idx" ON "tool_calls" USING btree ("workspace_id");
  CREATE INDEX "tool_calls_step_idx" ON "tool_calls" USING btree ("step_id");
  CREATE INDEX "tool_calls_run_idx" ON "tool_calls" USING btree ("run_id");
  CREATE INDEX "tool_calls_updated_at_idx" ON "tool_calls" USING btree ("updated_at");
  CREATE INDEX "tool_calls_created_at_idx" ON "tool_calls" USING btree ("created_at");
  CREATE INDEX "human_touches_workspace_idx" ON "human_touches" USING btree ("workspace_id");
  CREATE INDEX "human_touches_ticket_idx" ON "human_touches" USING btree ("ticket_id");
  CREATE INDEX "human_touches_run_idx" ON "human_touches" USING btree ("run_id");
  CREATE INDEX "human_touches_updated_at_idx" ON "human_touches" USING btree ("updated_at");
  CREATE INDEX "human_touches_created_at_idx" ON "human_touches" USING btree ("created_at");
  CREATE INDEX "workflow_versions_workspace_idx" ON "workflow_versions" USING btree ("workspace_id");
  CREATE INDEX "workflow_versions_product_idx" ON "workflow_versions" USING btree ("product_id");
  CREATE INDEX "workflow_versions_updated_at_idx" ON "workflow_versions" USING btree ("updated_at");
  CREATE INDEX "workflow_versions_created_at_idx" ON "workflow_versions" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_jobs_log_order_idx" ON "payload_jobs_log" USING btree ("_order");
  CREATE INDEX "payload_jobs_log_parent_id_idx" ON "payload_jobs_log" USING btree ("_parent_id");
  CREATE INDEX "payload_jobs_completed_at_idx" ON "payload_jobs" USING btree ("completed_at");
  CREATE INDEX "payload_jobs_total_tried_idx" ON "payload_jobs" USING btree ("total_tried");
  CREATE INDEX "payload_jobs_has_error_idx" ON "payload_jobs" USING btree ("has_error");
  CREATE INDEX "payload_jobs_task_slug_idx" ON "payload_jobs" USING btree ("task_slug");
  CREATE INDEX "payload_jobs_queue_idx" ON "payload_jobs" USING btree ("queue");
  CREATE INDEX "payload_jobs_wait_until_idx" ON "payload_jobs" USING btree ("wait_until");
  CREATE INDEX "payload_jobs_processing_idx" ON "payload_jobs" USING btree ("processing");
  CREATE INDEX "payload_jobs_concurrency_key_idx" ON "payload_jobs" USING btree ("concurrency_key");
  CREATE INDEX "payload_jobs_updated_at_idx" ON "payload_jobs" USING btree ("updated_at");
  CREATE INDEX "payload_jobs_created_at_idx" ON "payload_jobs" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_bauherren_id_idx" ON "payload_locked_documents_rels" USING btree ("bauherren_id");
  CREATE INDEX "payload_locked_documents_rels_workspaces_id_idx" ON "payload_locked_documents_rels" USING btree ("workspaces_id");
  CREATE INDEX "payload_locked_documents_rels_products_id_idx" ON "payload_locked_documents_rels" USING btree ("products_id");
  CREATE INDEX "payload_locked_documents_rels_connections_id_idx" ON "payload_locked_documents_rels" USING btree ("connections_id");
  CREATE INDEX "payload_locked_documents_rels_repositories_id_idx" ON "payload_locked_documents_rels" USING btree ("repositories_id");
  CREATE INDEX "payload_locked_documents_rels_ticket_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("ticket_sources_id");
  CREATE INDEX "payload_locked_documents_rels_tickets_id_idx" ON "payload_locked_documents_rels" USING btree ("tickets_id");
  CREATE INDEX "payload_locked_documents_rels_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("runs_id");
  CREATE INDEX "payload_locked_documents_rels_steps_id_idx" ON "payload_locked_documents_rels" USING btree ("steps_id");
  CREATE INDEX "payload_locked_documents_rels_tool_calls_id_idx" ON "payload_locked_documents_rels" USING btree ("tool_calls_id");
  CREATE INDEX "payload_locked_documents_rels_human_touches_id_idx" ON "payload_locked_documents_rels" USING btree ("human_touches_id");
  CREATE INDEX "payload_locked_documents_rels_workflow_versions_id_idx" ON "payload_locked_documents_rels" USING btree ("workflow_versions_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_bauherren_id_idx" ON "payload_preferences_rels" USING btree ("bauherren_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "bauherren_tenants" CASCADE;
  DROP TABLE "bauherren_sessions" CASCADE;
  DROP TABLE "bauherren" CASCADE;
  DROP TABLE "workspaces" CASCADE;
  DROP TABLE "products" CASCADE;
  DROP TABLE "connections" CASCADE;
  DROP TABLE "repositories" CASCADE;
  DROP TABLE "ticket_sources" CASCADE;
  DROP TABLE "tickets" CASCADE;
  DROP TABLE "tickets_texts" CASCADE;
  DROP TABLE "tickets_rels" CASCADE;
  DROP TABLE "runs" CASCADE;
  DROP TABLE "steps" CASCADE;
  DROP TABLE "tool_calls" CASCADE;
  DROP TABLE "human_touches" CASCADE;
  DROP TABLE "workflow_versions" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_jobs_log" CASCADE;
  DROP TABLE "payload_jobs" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "payload_jobs_stats" CASCADE;
  DROP TYPE "public"."enum_bauherren_role";
  DROP TYPE "public"."enum_workspaces_default_mode";
  DROP TYPE "public"."enum_connections_kind";
  DROP TYPE "public"."enum_tickets_state";
  DROP TYPE "public"."enum_runs_stage";
  DROP TYPE "public"."enum_runs_status";
  DROP TYPE "public"."enum_runs_mode";
  DROP TYPE "public"."enum_runs_cost_source";
  DROP TYPE "public"."enum_runs_reconcile_status";
  DROP TYPE "public"."enum_tool_calls_status";
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  DROP TYPE "public"."enum_payload_jobs_log_state";
  DROP TYPE "public"."enum_payload_jobs_task_slug";`)
}
