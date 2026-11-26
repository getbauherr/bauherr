import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

const o = { overrideAccess: true } as const

export const BULK_WORKSPACE = 'bulk'
export const BULK_TICKETS = 2806

const idOf = (doc: { id: number | string }): number => Number(doc.id)

const workspaceOf = async (payload: Payload): Promise<number> => {
  const found = await payload.find({ collection: 'workspaces', where: { slug: { equals: BULK_WORKSPACE } }, ...o })
  const data = { name: 'Bulk', slug: BULK_WORKSPACE }
  return idOf(found.docs[0] ?? (await payload.create({ collection: 'workspaces', data, ...o })))
}

const productOf = async (payload: Payload, workspace: number): Promise<number> => {
  const found = await payload.find({ collection: 'products', where: { slug: { equals: 'bulk-app' } }, ...o })
  const data = { name: 'Bulk App', slug: 'bulk-app', workspace, state: 'active' as const }
  return idOf(found.docs[0] ?? (await payload.create({ collection: 'products', data, ...o })))
}

const ensureRepo = async (payload: Payload, workspace: number, product: number) => {
  const where = { fullName: { equals: 'bulk/app' } }
  const found = await payload.find({ collection: 'repositories', where, limit: 1, ...o })
  if (found.docs.length) return
  const connection = await payload.create({
    collection: 'connections',
    data: { name: 'GitHub Bulk', kind: 'github', config: {}, secret: 'e2e-dummy-secret', workspace },
    ...o,
  })
  await payload.create({ collection: 'repositories', data: { fullName: 'bulk/app', product, workspace }, ...o })
  await payload.create({
    collection: 'ticket_sources',
    data: { repo: 'bulk/app', product, connection: connection.id, cursor: '2026-10-30T09:00:00Z', workspace },
    ...o,
  })
}

export const BULK_OWNER = 'po-bulk@example.com'

type User = (address: string, role: string, extra: Record<string, unknown>) => Promise<unknown>

export const seedBulk = async (payload: Payload, user: User) => {
  const workspace = await workspaceOf(payload)
  const product = await productOf(payload, workspace)
  await user(BULK_OWNER, 'product-owner', {
    githubLogin: 'bulk',
    assignments: [{ workspace, scope: 'products', products: [product] }],
  })
  await ensureRepo(payload, workspace, product)
  const inBulk = { workspace: { equals: workspace } }
  const seeded = await payload.find({ collection: 'records', where: inBulk, limit: 1, ...o })
  if (seeded.docs.length) return
  const db = payload.db.drizzle
  await db.execute(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
      "waiting_on", "card", "data", "updated_at", "created_at")
    SELECT ${workspace}, ${product}, 'github', 'bulk/app', n, stage, waiting_on,
      CASE WHEN waiting_on = 'owner'
        THEN jsonb_build_object('card', 'brief', 'reason', 'approval', 'options', '[]'::jsonb, 'seq', 0) END,
      jsonb_build_object('type', 'bug', 'source', jsonb_build_object('forge', 'github', 'repo', 'bulk/app',
        'number', n, 'reporter', 'bulk', 'external', false, 'backlog', false)),
      now() - n * interval '1 minute', now() - n * interval '1 minute' - interval '1 day'
    FROM (
      SELECT n,
        (ARRAY['done','done','done','done','done','done','done','done','done','done','done',
          'intake','brief','brief','build','build','verify','verify','ship','intake'])[n % 20 + 1] AS stage,
        CASE WHEN n % 20 > 10 AND n % 19 = 0 THEN 'owner' ELSE
          (ARRAY['nobody','nobody','nobody','nobody','nobody','nobody','nobody','nobody','nobody','nobody','nobody',
            'agents','reporter','agents','agents','reporter','agents','author','reporter','reporter'])[n % 20 + 1]
        END AS waiting_on
      FROM generate_series(1, ${BULK_TICKETS}) n) t`)
  await db.execute(sql`
    INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "created_at", "updated_at")
    SELECT "workspace_id", "id", 'result.accepted', 'owner', '{}'::jsonb, "updated_at", "updated_at"
    FROM "records" WHERE "workspace_id" = ${workspace} AND "stage" = 'done'`)
  await db.execute(sql`
    INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role", "status", "fingerprint", "steps")
    SELECT "workspace_id", "id", "stage", CASE "stage" WHEN 'build' THEN 'builder' ELSE 'verifier' END, 'queued',
      'bulk', '[]'::jsonb
    FROM "records" WHERE "workspace_id" = ${workspace} AND "waiting_on" = 'agents' AND "stage" IN ('build', 'verify')`)
}
