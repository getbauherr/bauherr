import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { decrypt } from '../lib/secrets'
import { DEFAULT_MODEL_BY_TIER, gatewayEnabled, renderModels, writeProvider } from '../lib/gateway'
import { PRESETS, presetOf } from '../lib/providers'

const TIER_DEFAULTS = Object.entries(DEFAULT_MODEL_BY_TIER).map(([t, m]) => `'${t}', s.slug || '/${m}'`).join(', ')

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
  // Provider files are now per Connection (`ws-<workspace>.<connection>.<ext>`); rewrite them and the gateway entries, drop the old per-Workspace files.
  try {
    const { docs } = await payload.find({ collection: 'connections', where: { kind: { equals: 'llm-provider' } }, depth: 1, pagination: false, overrideAccess: true, req })
    for (const c of docs) {
      const ws = (c.workspace as { slug?: string } | null)?.slug
      const def = PRESETS[presetOf(c.config as never)]
      if (!ws || !c.slug) continue
      if (def.auth === 'file' && c.secret) await writeProvider(ws, c.slug as string, decrypt(c.secret as string), def.secret.ext)
      for (const ext of ['key', 'json']) await rm(join(process.env.GATEWAY_CONFIG_DIR ?? '/gateway', 'providers', `ws-${ws}.${ext}`), { force: true })
    }
    await renderModels(req)
  } catch (e) {
    payload.logger.error(`connection_slugs: gateway files not rewritten (${(e as Error).message}); save any llm-provider Connection to rewrite them`)
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
