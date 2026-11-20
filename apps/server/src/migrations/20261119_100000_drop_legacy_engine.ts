import { MigrateUpArgs, sql } from '@payloadcms/db-postgres'

const REMOVED_TASKS = [
  'poll-tickets',
  'run-stage',
  'expire-sessions',
  'watch-release',
  'notify-gates',
  'watch-reviews',
  'watch-production',
  'resume-reviews',
  'publish-release',
  'watch-knowledge-prs',
  'reconcile-costs',
  'prune-request-logs',
  'prune-comment-media',
  'merge-main',
  'watch-liveness',
  'security-scan-tick',
  'distill-skill',
  'sync-progress',
  'store-ci-summary',
]

const rebuildEnum = (
  type: string,
  table: string,
  column: string,
  labels: string[],
  fallback?: string,
) => `
  ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT;
  CREATE TYPE "public"."${type}_new" AS ENUM(${labels.map((l) => `'${l}'`).join(', ')});
  ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE "public"."${type}_new"
    USING "${column}"::text::"public"."${type}_new";
  DROP TYPE "public"."${type}";
  ALTER TYPE "public"."${type}_new" RENAME TO "${type}";${fallback ? `
  ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT '${fallback}';` : ''}`

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   DELETE FROM "connections" WHERE "kind"::text = 'monitoring' OR "provider"::text = 'router';
   DELETE FROM "knowledge_chunks" WHERE "layer"::text = 'core';`)
  const removedTasks = sql.join(
    REMOVED_TASKS.map((t) => sql`${t}`),
    sql`, `,
  )
  await db.execute(sql`DELETE FROM "payload_jobs" WHERE "task_slug"::text IN (${removedTasks});`)
  await db.execute(sql`
   ALTER TABLE "payload_locked_documents_rels"
    DROP COLUMN IF EXISTS "artifacts_id",
    DROP COLUMN IF EXISTS "chat_messages_id",
    DROP COLUMN IF EXISTS "chat_threads_id",
    DROP COLUMN IF EXISTS "check_flakes_id",
    DROP COLUMN IF EXISTS "embed_tokens_id",
    DROP COLUMN IF EXISTS "inbox_seen_id",
    DROP COLUMN IF EXISTS "intake_sessions_id",
    DROP COLUMN IF EXISTS "media_id",
    DROP COLUMN IF EXISTS "runs_id",
    DROP COLUMN IF EXISTS "session_spans_id",
    DROP COLUMN IF EXISTS "skill_proposals_id",
    DROP COLUMN IF EXISTS "steps_id",
    DROP COLUMN IF EXISTS "templates_id",
    DROP COLUMN IF EXISTS "ticket_events_id",
    DROP COLUMN IF EXISTS "tickets_id",
    DROP COLUMN IF EXISTS "tool_calls_id",
    DROP COLUMN IF EXISTS "usage_cursors_id",
    DROP COLUMN IF EXISTS "usage_entries_id",
    DROP COLUMN IF EXISTS "workflow_versions_id";`)
  await db.execute(sql`
   ALTER TABLE "human_touches"
    DROP COLUMN IF EXISTS "addressee",
    DROP COLUMN IF EXISTS "as",
    DROP COLUMN IF EXISTS "base_content",
    DROP COLUMN IF EXISTS "head_sha",
    DROP COLUMN IF EXISTS "path",
    DROP COLUMN IF EXISTS "pr_number",
    DROP COLUMN IF EXISTS "repo",
    DROP COLUMN IF EXISTS "run_id",
    DROP COLUMN IF EXISTS "ticket_id";`)
  await db.execute(sql`
   ALTER TABLE "workspaces"
    DROP COLUMN IF EXISTS "default_mode",
    DROP COLUMN IF EXISTS "expedite_lane",
    DROP COLUMN IF EXISTS "mode_by_stage",
    DROP COLUMN IF EXISTS "preempt_for_hotfix",
    DROP COLUMN IF EXISTS "progress_comments",
    DROP COLUMN IF EXISTS "router_budget_share",
    DROP COLUMN IF EXISTS "router_key",
    DROP COLUMN IF EXISTS "wip_limits",
    DROP COLUMN IF EXISTS "workflow_version_id";`)
  await db.execute(sql`
   ALTER TABLE "products"
    DROP COLUMN IF EXISTS "auto_merge",
    DROP COLUMN IF EXISTS "check_retries",
    DROP COLUMN IF EXISTS "docs_check_last_check_at",
    DROP COLUMN IF EXISTS "docs_check_last_check_run",
    DROP COLUMN IF EXISTS "docs_check_paths",
    DROP COLUMN IF EXISTS "expedite_skip_staging",
    DROP COLUMN IF EXISTS "expedite_skip_staging_at",
    DROP COLUMN IF EXISTS "expedite_skip_staging_by",
    DROP COLUMN IF EXISTS "last_release_at",
    DROP COLUMN IF EXISTS "last_release_sha",
    DROP COLUMN IF EXISTS "last_release_tag",
    DROP COLUMN IF EXISTS "merge_mode",
    DROP COLUMN IF EXISTS "merge_preflight",
    DROP COLUMN IF EXISTS "overlap_ignore",
    DROP COLUMN IF EXISTS "overlap_suggestions",
    DROP COLUMN IF EXISTS "product_owner_tests_staging",
    DROP COLUMN IF EXISTS "release_checks",
    DROP COLUMN IF EXISTS "release_prerelease",
    DROP COLUMN IF EXISTS "release_reminder_days",
    DROP COLUMN IF EXISTS "review_checks",
    DROP COLUMN IF EXISTS "security_scan_cron",
    DROP COLUMN IF EXISTS "security_scan_enabled",
    DROP COLUMN IF EXISTS "security_scan_last_scan_at",
    DROP COLUMN IF EXISTS "security_scan_max_budget_usd",
    DROP COLUMN IF EXISTS "security_scan_max_turns",
    DROP COLUMN IF EXISTS "train_state",
    DROP COLUMN IF EXISTS "unlinked_gate_owners";`)
  await db.execute(sql`
   ALTER TABLE "connections"
    DROP COLUMN IF EXISTS "service";`)
  await db.execute(sql`
   DROP TABLE IF EXISTS "artifacts", "chat_messages", "chat_threads", "check_flakes", "embed_tokens", "inbox_seen",
       "intake_sessions", "media", "runs", "session_spans", "skill_proposals", "steps", "templates", "ticket_events",
       "tickets", "tickets_rels", "tickets_texts", "tool_calls", "usage_cursors", "usage_entries", "workflow_versions"
       CASCADE;`)
  await db.execute(sql`
   DROP TYPE IF EXISTS "public"."enum_artifacts_kind";
   DROP TYPE IF EXISTS "public"."enum_artifacts_pair";
   DROP TYPE IF EXISTS "public"."enum_check_flakes_outcome";
   DROP TYPE IF EXISTS "public"."enum_connections_service";
   DROP TYPE IF EXISTS "public"."enum_human_touches_addressee";
   DROP TYPE IF EXISTS "public"."enum_human_touches_as";
   DROP TYPE IF EXISTS "public"."enum_intake_sessions_kind";
   DROP TYPE IF EXISTS "public"."enum_intake_sessions_persona";
   DROP TYPE IF EXISTS "public"."enum_intake_sessions_status";
   DROP TYPE IF EXISTS "public"."enum_intake_sessions_urgency";
   DROP TYPE IF EXISTS "public"."enum_media_mime";
   DROP TYPE IF EXISTS "public"."enum_products_merge_mode";
   DROP TYPE IF EXISTS "public"."enum_runs_cost_source";
   DROP TYPE IF EXISTS "public"."enum_runs_mode";
   DROP TYPE IF EXISTS "public"."enum_runs_reason_kind";
   DROP TYPE IF EXISTS "public"."enum_runs_reconcile_status";
   DROP TYPE IF EXISTS "public"."enum_runs_status";
   DROP TYPE IF EXISTS "public"."enum_runs_verdict";
   DROP TYPE IF EXISTS "public"."enum_skill_proposals_status";
   DROP TYPE IF EXISTS "public"."enum_steps_state";
   DROP TYPE IF EXISTS "public"."enum_templates_name";
   DROP TYPE IF EXISTS "public"."enum_ticket_events_executor";
   DROP TYPE IF EXISTS "public"."enum_ticket_events_phase";
   DROP TYPE IF EXISTS "public"."enum_tickets_needs_by";
   DROP TYPE IF EXISTS "public"."enum_tickets_production_state";
   DROP TYPE IF EXISTS "public"."enum_tickets_release_checks_state";
   DROP TYPE IF EXISTS "public"."enum_tickets_release_state";
   DROP TYPE IF EXISTS "public"."enum_tickets_review_state";
   DROP TYPE IF EXISTS "public"."enum_tickets_state";
   DROP TYPE IF EXISTS "public"."enum_tool_calls_status";
   DROP TYPE IF EXISTS "public"."enum_usage_entries_source";
   DROP TYPE IF EXISTS "public"."enum_workspaces_default_mode";`)
  await db.execute(
    sql.raw(rebuildEnum('enum_connections_kind', 'connections', 'kind', ['github', 'gitlab', 'llm-provider'])),
  )
  await db.execute(
    sql.raw(
      rebuildEnum(
        'enum_connections_provider',
        'connections',
        'provider',
        [
          'anthropic',
          'openai',
          'gemini',
          'greenpt',
          'bedrock',
          'vertex',
          'foundry',
          'anthropic-compatible',
          'openai-compatible',
          'bedrock-iam',
          'foundry-entra',
          'bedrock-ambient',
          'vertex-ambient',
          'foundry-ambient',
        ],
        'anthropic',
      ),
    ),
  )
  await db.execute(
    sql.raw(rebuildEnum('enum_knowledge_chunks_layer', 'knowledge_chunks', 'layer', ['workspace', 'product'])),
  )
}

export async function down(): Promise<void> {
  throw new Error(
    'Cannot roll back: the legacy engine tables are dropped. The schema is in git at the tag legacy-final.',
  )
}
