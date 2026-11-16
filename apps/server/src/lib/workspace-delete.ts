import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type Where } from 'payload'
import { deleteKey, gatewayEnabled, renderModels } from './gateway'
import { personOf } from './person'

type Doc = Record<string, any>

export const RESTORE_DAYS = 14
export const ARCHIVE_LOCK = 'workspace-archive'
export const ARCHIVE_REASON = 'Workspace deleted'

/** Where: the Workspace is not archived. */
export const live: Where = { archivedAt: { exists: false } }

/** Where: the document belongs to no archived Workspace. */
export const inLiveWorkspace = async (payload: Payload): Promise<Where> => {
  const gone = (await payload.find({ collection: 'workspaces', where: { archivedAt: { exists: true } }, select: {}, pagination: false, depth: 0, overrideAccess: true })).docs.map((w) => w.id)
  return gone.length ? { workspace: { not_in: gone } } : {}
}

/** Whether the Workspace is archived (its Tickets take no more decisions). */
export const isArchived = async (payload: Payload, workspace: number | string): Promise<boolean> =>
  (await payload.count({ collection: 'workspaces', where: { and: [{ id: { equals: workspace } }, { archivedAt: { exists: true } }] }, overrideAccess: true })).totalDocs > 0

/** Archived Workspaces that can still be restored, newest deletion first. */
export const archivedWorkspaces = async (payload: Payload): Promise<{ id: number; name: string; slug: string; archivedAt: string; purgeAt: string }[]> =>
  (await payload.find({ collection: 'workspaces', where: { archivedAt: { exists: true } }, sort: '-archivedAt', select: { name: true, slug: true, archivedAt: true, purgeAt: true }, pagination: false, depth: 0, overrideAccess: true })).docs as never

const assertAdmin = (user: Doc): void => {
  if (user.role !== 'admin') throw new Error('Only an Admin can delete or restore a Workspace.')
}

/** What deleting the Workspace removes, for the confirmation dialog. */
export const deleteImpact = async (payload: Payload, workspace: number): Promise<Record<'products' | 'tickets' | 'runs' | 'sessions' | 'keys' | 'connections', number>> => {
  const n = async (collection: string, where: Where) => (await payload.count({ collection, where: { and: [{ workspace: { equals: workspace } }, where] }, overrideAccess: true } as never)).totalDocs
  const [products, tickets, runs, sessions, tokens, connections] = await Promise.all([
    n('products', {}),
    n('tickets', {}),
    n('runs', { status: { in: ['queued', 'awaiting_session', 'running'] } }),
    n('agent_sessions', { disconnectedAt: { exists: false } }),
    n('embed_tokens', { revokedAt: { exists: false } }),
    n('connections', {}),
  ])
  return { products, tickets, runs, sessions, keys: tokens + 1, connections }
}

/**
 * Archives the Workspace (Admin only; refused for the last live one) in one transaction under an advisory lock:
 * Runs still queued, awaiting or running are cancelled, its sessions end, its gateway and router keys (and the owner-session key) and embed tokens are revoked, and one audit row without a Workspace link keeps id, slug and name.
 * Personal agent keys stay. Restorable until `purgeAt`.
 */
export const archiveWorkspace = async (payload: Payload, user: Doc, workspace: number, now = new Date()): Promise<void> => {
  assertAdmin(user)
  const actor = personOf(user)
  const purgeAt = new Date(now.getTime() + RESTORE_DAYS * 86_400_000)
  const db = payload.db.drizzle
  const slug = await db.transaction(async (tx: typeof db) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ARCHIVE_LOCK}))`)
    const ws = (await tx.execute(sql`SELECT "id", "slug", "name", "archived_at" FROM "workspaces" WHERE "id" = ${workspace}`)).rows[0] as { id: number; slug: string; name: string; archived_at: string | null } | undefined
    if (!ws || ws.archived_at) throw new Error('Workspace not found.')
    if (!(await tx.execute(sql`SELECT 1 FROM "workspaces" WHERE "archived_at" IS NULL AND "id" <> ${workspace} LIMIT 1`)).rows.length) throw new Error('You cannot delete your last Workspace.')
    await tx.execute(sql`UPDATE "workspaces" SET "archived_at" = ${now.toISOString()}, "purge_at" = ${purgeAt.toISOString()}, "gateway_key" = NULL, "router_key" = NULL, "updated_at" = now() WHERE "id" = ${workspace}`)
    await tx.execute(sql`UPDATE "runs" SET "status" = 'cancelled', "error" = ${ARCHIVE_REASON}, "finished_at" = now(), "updated_at" = now() WHERE "workspace_id" = ${workspace} AND "status" IN ('queued', 'awaiting_session', 'running')`)
    await tx.execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now(), "end_reason" = 'disconnect', "updated_at" = now() WHERE "workspace_id" = ${workspace} AND "disconnected_at" IS NULL`)
    await tx.execute(sql`UPDATE "embed_tokens" SET "revoked_at" = now(), "updated_at" = now() WHERE "workspace_id" = ${workspace} AND "revoked_at" IS NULL`)
    await tx.execute(sql`INSERT INTO "human_touches" ("kind", "actor", "at", "detail", "updated_at", "created_at") VALUES ('workspace:delete', ${actor}, now(), ${JSON.stringify({ id: ws.id, slug: ws.slug, name: ws.name })}::jsonb, now(), now())`)
    if (gatewayEnabled()) await deleteKey(ws.slug)
    return ws.slug
  })
  if (gatewayEnabled()) await renderModels(await createLocalReq({}, payload)).catch((err) => payload.logger.error({ err, slug }, 'workspace archived; gateway models not re-rendered'))
}

/** Restores an archived Workspace before `purgeAt` (any Admin). Keys are not restored: mint new ones. */
export const restoreWorkspace = async (payload: Payload, user: Doc, workspace: number, now = new Date()): Promise<void> => {
  assertAdmin(user)
  const actor = personOf(user)
  const db = payload.db.drizzle
  await db.transaction(async (tx: typeof db) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ARCHIVE_LOCK}))`)
    const ws = (await tx.execute(sql`SELECT "id", "slug", "name", "archived_at", "purge_at" FROM "workspaces" WHERE "id" = ${workspace}`)).rows[0] as { id: number; slug: string; name: string; archived_at: string | null; purge_at: string | null } | undefined
    if (!ws?.archived_at || (ws.purge_at && new Date(ws.purge_at) <= now)) throw new Error('This Workspace cannot be restored.')
    await tx.execute(sql`UPDATE "workspaces" SET "archived_at" = NULL, "purge_at" = NULL, "updated_at" = now() WHERE "id" = ${workspace}`)
    await tx.execute(sql`INSERT INTO "human_touches" ("workspace_id", "kind", "actor", "at", "detail", "updated_at", "created_at") VALUES (${workspace}, 'workspace:restore', ${actor}, now(), ${JSON.stringify({ id: ws.id, slug: ws.slug, name: ws.name })}::jsonb, now(), now())`)
  })
  if (gatewayEnabled()) await renderModels(await createLocalReq({}, payload)).catch((err) => payload.logger.error({ err, workspace }, 'workspace restored; gateway models not re-rendered'))
}
