import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decrypt } from '../lib/secrets'
import { gatewayEnabled, renderModels, writeProvider } from '../lib/gateway'
import { PRESETS, presetOf } from '../lib/providers'

const TIER_DEFAULTS = `'cheap', s.slug || '/claude-haiku-5-5', 'standard', s.slug || '/claude-sonnet-5-5', 'strong', s.slug || '/claude-opus-5-5'`

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
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
  if (!gatewayEnabled()) return
  // Provider files are now per Connection (`ws-<workspace>.<connection>.<ext>`). Frozen SQL: only columns that exist at this migration.
  const { rows } = await db.execute(sql`SELECT c.slug, c.secret, c.config, w.slug AS ws FROM connections c JOIN workspaces w ON w.id = c.workspace_id WHERE c.kind = 'llm-provider'`)
  try {
    for (const c of rows as { slug: string | null; secret: string | null; config: never; ws: string | null }[]) {
      const def = PRESETS[presetOf(c.config)]
      if (!c.ws || !c.slug) continue
      if (def.auth === 'file' && c.secret) await writeProvider(c.ws, c.slug, decrypt(c.secret), def.secret.ext)
      for (const ext of ['key', 'json']) await rm(join(process.env.GATEWAY_CONFIG_DIR ?? '/gateway', 'providers', `ws-${c.ws}.${ext}`), { force: true })
    }
  } catch (e) {
    payload.logger.error(`connection_slugs: provider files not rewritten (${(e as Error).message}); save any llm-provider Connection to rewrite them`)
  }
  // renderModels runs today's app code, which may read later columns: a savepoint keeps its failure from aborting the schema change above.
  await db.execute(sql`SAVEPOINT connection_slugs_render`)
  try {
    await renderModels(req)
    await db.execute(sql`RELEASE SAVEPOINT connection_slugs_render`)
  } catch (e) {
    await db.execute(sql`ROLLBACK TO SAVEPOINT connection_slugs_render`)
    payload.logger.error(`connection_slugs: gateway config not rendered (${(e as Error).message}); save any llm-provider Connection to render it`)
  }
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
