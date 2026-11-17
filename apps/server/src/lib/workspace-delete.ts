import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type Where } from 'payload'
import { deleteKey, gatewayEnabled, removeWorkspaceProviders, renderModels } from './gateway'
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

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: Doc[] }> }
const ofWorkspace = (ws: number) => sql`"workspace_id" = ${ws}`
const mediaOf = (ws: number) => sql`"workspace_id" = ${ws} OR "product_id" IN (SELECT "id" FROM "products" WHERE "workspace_id" = ${ws})`
const ticketsOf = (ws: number) => sql`(SELECT "id" FROM "tickets" WHERE "workspace_id" = ${ws})`

/**
 * Every table that holds rows of a Workspace, children before parents (derived from the FK graph; `workspace-delete-purge.test.ts` checks the order and that no table pointing at a Workspace, Ticket or Product is missing).
 * `human_touches` keeps its `workspace:*` audit rows (detached), the others go.
 */
export const PURGE_ORDER: { table: string; where: (ws: number) => ReturnType<typeof sql> }[] = [
  ...['usage_entries', 'usage_cursors', 'tool_calls', 'steps', 'session_spans', 'artifacts', 'skill_proposals', 'ticket_events', 'check_flakes', 'inbox_seen'].map((table) => ({ table, where: ofWorkspace })),
  { table: 'human_touches', where: (ws) => sql`("workspace_id" = ${ws} OR "ticket_id" IN ${ticketsOf(ws)}) AND "kind" NOT LIKE 'workspace:%'` },
  ...['chat_messages', 'chat_threads', 'runs', 'agent_sessions'].map((table) => ({ table, where: ofWorkspace })),
  { table: 'media', where: (ws) => mediaOf(ws) },
  ...['intake_sessions', 'embed_tokens'].map((table) => ({ table, where: ofWorkspace })),
  { table: 'tickets_rels', where: (ws) => sql`"parent_id" IN ${ticketsOf(ws)} OR "tickets_id" IN ${ticketsOf(ws)}` },
  { table: 'tickets_texts', where: (ws) => sql`"parent_id" IN ${ticketsOf(ws)}` },
  ...['tickets', 'ticket_sources', 'repositories', 'workflow_versions', 'products', 'connections', 'templates', 'knowledge_chunks', 'bauherren_assignments'].map((table) => ({ table, where: ofWorkspace })),
  { table: 'bauherren_tenants', where: (ws) => sql`"tenant_id" = ${ws}` },
  { table: 'workspaces', where: (ws) => sql`"id" = ${ws}` },
]

/** Tables with no purge statement of their own: their rows go with a parent (`ON DELETE CASCADE`) or are not the Workspace's (people are only unlinked). */
export const PURGE_CASCADED = ['bauherren_rels', 'payload_locked_documents_rels']

/** Takes the Workspace out of every person that reaches it (tenants and Product-owner assignments); a person is never deleted. */
const unlinkPeople = async (payload: Payload, ws: number, req: Awaited<ReturnType<typeof createLocalReq>>): Promise<void> => {
  const people = (await payload.find({ collection: 'bauherren', where: { or: [{ 'tenants.tenant': { equals: ws } }, { 'assignments.workspace': { equals: ws } }] }, pagination: false, depth: 0, overrideAccess: true, req })).docs as Doc[]
  for (const u of people) {
    const data: Doc = { tenants: (u.tenants ?? []).map((t: Doc) => ({ tenant: t.tenant })).filter((t: Doc) => t.tenant !== ws) }
    if (u.assignments?.length) data.assignments = u.assignments.filter((a: Doc) => a.workspace !== ws)
    await payload.update({ collection: 'bauherren', id: u.id, data, overrideAccess: true, depth: 0, req })
  }
}

/**
 * Hard-deletes an archived Workspace whose `purgeAt` has passed; false when it is not (a Restore in between wins).
 * One transaction under the archive lock: re-check, unlink people, delete in `PURGE_ORDER`, write `workspace:purge`. Any error rolls everything back.
 * Media files and gateway provider files go after the commit; a failure there is logged only.
 */
export const purgeWorkspace = async (payload: Payload, workspace: number, now = new Date()): Promise<boolean> => {
  const req = await createLocalReq({}, payload)
  const txId = await payload.db.beginTransaction()
  if (!txId) throw new Error('database transactions unavailable')
  req.transactionID = txId
  const tx = (payload.db as unknown as { sessions: Record<string, { db: Exec }> }).sessions[await txId]!.db
  let files: string[] = []
  let slug = ''
  try {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ARCHIVE_LOCK}))`)
    const ws = (await tx.execute(sql`SELECT "id", "slug", "name" FROM "workspaces" WHERE "id" = ${workspace} AND "archived_at" IS NOT NULL AND "purge_at" <= ${now.toISOString()}`)).rows[0] as { id: number; slug: string; name: string } | undefined
    if (!ws) {
      await payload.db.rollbackTransaction(txId)
      return false
    }
    slug = ws.slug
    files = (await tx.execute(sql`SELECT "filename" FROM "media" WHERE "filename" IS NOT NULL AND (${mediaOf(workspace)})`)).rows.map((r) => r.filename as string)
    await unlinkPeople(payload, workspace, req)
    await tx.execute(sql`UPDATE "human_touches" SET "workspace_id" = NULL WHERE "workspace_id" = ${workspace} AND "kind" LIKE 'workspace:%'`)
    await tx.execute(sql`UPDATE "workspaces" SET "workflow_version_id" = NULL, "knowledge_connection_id" = NULL WHERE "id" = ${workspace}`)
    for (const { table, where } of PURGE_ORDER) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${where(workspace)}`)
    await tx.execute(sql`INSERT INTO "human_touches" ("kind", "actor", "at", "detail", "updated_at", "created_at") VALUES ('workspace:purge', 'system', now(), ${JSON.stringify({ id: ws.id, slug: ws.slug, name: ws.name })}::jsonb, now(), now())`)
    await payload.db.commitTransaction(txId)
  } catch (e) {
    await payload.db.rollbackTransaction(txId)
    throw e
  }
  const dir = (payload.collections.media.config.upload as { staticDir?: string }).staticDir ?? ''
  for (const f of files) await rm(join(dir, basename(f)), { force: true }).catch((err) => payload.logger.error({ err, file: f, slug }, 'workspace purged; media file not deleted'))
  if (gatewayEnabled()) {
    await removeWorkspaceProviders(slug).catch((err) => payload.logger.error({ err, slug }, 'workspace purged; provider files not removed'))
    await renderModels(await createLocalReq({}, payload)).catch((err) => payload.logger.error({ err, slug }, 'workspace purged; gateway models not re-rendered'))
  }
  return true
}

/** Purges every archived Workspace past its `purgeAt`, one transaction each; a failure is logged and retried by the next run. Returns the ids purged. */
export const purgeDueWorkspaces = async (payload: Payload, now = new Date()): Promise<number[]> => {
  const due = (await payload.find({ collection: 'workspaces', where: { and: [{ archivedAt: { exists: true } }, { purgeAt: { less_than_equal: now.toISOString() } }] }, select: {}, pagination: false, depth: 0, overrideAccess: true })).docs.map((w) => w.id as number)
  const purged: number[] = []
  for (const id of due) {
    try {
      if (await purgeWorkspace(payload, id, now)) purged.push(id)
    } catch (err) {
      payload.logger.error({ err, workspace: id }, 'workspace purge failed; retried on the next run')
    }
  }
  return purged
}
