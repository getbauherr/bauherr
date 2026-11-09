import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

const TIER_DEFAULTS = `'cheap', s.slug || '/claude-haiku-5-5', 'standard', s.slug || '/claude-sonnet-5-5', 'strong', s.slug || '/claude-opus-5-5'`

export async function up({ db, payload }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "slug" varchar;
  UPDATE "connections" c SET "slug" = r.slug FROM (
    SELECT id, CASE WHEN row_number() OVER w = 1 THEN coalesce(provider::text, 'anthropic') ELSE coalesce(provider::text, 'anthropic') || '-' || row_number() OVER w END AS slug
    FROM "connections" WHERE kind = 'llm-provider' WINDOW w AS (PARTITION BY workspace_id, provider ORDER BY id)
  ) r WHERE c.id = r.id AND c.slug IS NULL;
  UPDATE "workspaces" w SET "model_by_tier" = (
    SELECT jsonb_object_agg(t.k, CASE WHEN EXISTS (SELECT 1 FROM "connections" x WHERE x.workspace_id = w.id AND x.kind = 'llm-provider' AND t.v LIKE x.slug || '/%') THEN t.v ELSE f.slug || '/' || t.v END)
    FROM jsonb_each_text(w."model_by_tier") t(k, v)
  ) FROM (SELECT DISTINCT ON (workspace_id) workspace_id, slug FROM "connections" WHERE kind = 'llm-provider' AND slug IS NOT NULL ORDER BY workspace_id, id) f
  WHERE f.workspace_id = w.id AND jsonb_typeof(w."model_by_tier") = 'object' AND w."model_by_tier" <> '{}'::jsonb;
  UPDATE "workspaces" w SET "model_by_tier" = jsonb_build_object(${sql.raw(TIER_DEFAULTS)})
    || coalesce(CASE WHEN jsonb_typeof(w."model_by_tier") = 'object' THEN w."model_by_tier" END, '{}'::jsonb)
  FROM (SELECT workspace_id, min(slug) AS slug FROM "connections" WHERE kind = 'llm-provider' GROUP BY workspace_id HAVING count(*) = 1) s
  WHERE s.workspace_id = w.id AND NOT (coalesce(w."model_by_tier", '{}'::jsonb) ?& ARRAY['cheap','standard','strong']);
  CREATE UNIQUE INDEX IF NOT EXISTS "workspace_slug_idx" ON "connections" ("workspace_id", "slug");`)
  if (process.env.GATEWAY_ADMIN_URL) payload.logger.warn('connection_slugs: gateway files are not rewritten here; save any llm-provider Connection to rewrite them')
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "workspace_slug_idx";
   UPDATE "workspaces" w SET "model_by_tier" = (
    SELECT jsonb_object_agg(t.k, regexp_replace(t.v, '^[^/]+/', ''))
    FROM jsonb_each_text(w."model_by_tier") t(k, v)
  ) WHERE jsonb_typeof(w."model_by_tier") = 'object' AND w."model_by_tier" <> '{}'::jsonb
    AND EXISTS (SELECT 1 FROM "connections" x WHERE x.workspace_id = w.id AND x.kind = 'llm-provider');
  ALTER TABLE "connections" DROP COLUMN "slug";`)
}
