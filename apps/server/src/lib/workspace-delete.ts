import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type Where } from 'payload'
import { deleteKey, gatewayEnabled, removeWorkspaceProviders, renderModels } from './gateway'
import { personOf } from './person'

type Doc = Record<string, any>

export const RESTORE_DAYS = 14
export const ARCHIVE_LOCK = 'workspace-archive'
export const ARCHIVE_REASON = 'Workspace deleted'

export const live: Where = { archivedAt: { exists: false } }

export const inLiveWorkspace = async (payload: Payload): Promise<Where> => {
  const gone = (await payload.find({ collection: 'workspaces', where: { archivedAt: { exists: true } }, select: {}, pagination: false, depth: 0, overrideAccess: true })).docs.map((w) => w.id)
  return gone.length ? { workspace: { not_in: gone } } : {}
}

export const isArchived = async (payload: Payload, workspace: number | string): Promise<boolean> =>
  (await payload.count({ collection: 'workspaces', where: { and: [{ id: { equals: workspace } }, { archivedAt: { exists: true } }] }, overrideAccess: true })).totalDocs > 0

export const archivedWorkspaces = async (payload: Payload): Promise<{ id: number; name: string; slug: string; archivedAt: string; purgeAt: string }[]> =>
  (await payload.find({ collection: 'workspaces', where: { archivedAt: { exists: true } }, sort: '-archivedAt', select: { name: true, slug: true, archivedAt: true, purgeAt: true }, pagination: false, depth: 0, overrideAccess: true })).docs as never

const assertAdmin = (user: Doc): void => {
  if (user.role !== 'admin') throw new Error('Only an Admin can delete or restore a Workspace.')
}

export const deleteImpact = async (payload: Payload, workspace: number): Promise<Record<'products' | 'sessions' | 'connections', number>> => {
  const n = async (collection: string, where: Where) => (await payload.count({ collection, where: { and: [{ workspace: { equals: workspace } }, where] }, overrideAccess: true } as never)).totalDocs
  const [products, sessions, connections] = await Promise.all([n('products', {}), n('agent_sessions', { disconnectedAt: { exists: false } }), n('connections', {})])
  return { products, sessions, connections }
}

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
    await tx.execute(sql`UPDATE "workspaces" SET "archived_at" = ${now.toISOString()}, "purge_at" = ${purgeAt.toISOString()}, "gateway_key" = NULL, "updated_at" = now() WHERE "id" = ${workspace}`)
    await tx.execute(sql`UPDATE "agent_sessions" SET "disconnected_at" = now(), "end_reason" = 'disconnect', "updated_at" = now() WHERE "workspace_id" = ${workspace} AND "disconnected_at" IS NULL`)
    await tx.execute(sql`INSERT INTO "human_touches" ("kind", "actor", "at", "detail", "updated_at", "created_at") VALUES ('workspace:delete', ${actor}, now(), ${JSON.stringify({ id: ws.id, slug: ws.slug, name: ws.name })}::jsonb, now(), now())`)
    if (gatewayEnabled()) await deleteKey(ws.slug)
    return ws.slug
  })
  if (gatewayEnabled()) await renderModels(await createLocalReq({}, payload)).catch((err) => payload.logger.error({ err, slug }, 'workspace archived; gateway models not re-rendered'))
}

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
export const PURGE_ORDER: { table: string; where: (ws: number) => ReturnType<typeof sql> }[] = [
  { table: 'human_touches', where: (ws) => sql`"workspace_id" = ${ws} AND "kind" NOT LIKE 'workspace:%'` },
  ...['events', 'records', 'agent_sessions', 'ticket_sources', 'repositories', 'products', 'connections', 'knowledge_chunks', 'bauherren_assignments'].map((table) => ({ table, where: ofWorkspace })),
  { table: 'bauherren_tenants', where: (ws) => sql`"tenant_id" = ${ws}` },
  { table: 'workspaces', where: (ws) => sql`"id" = ${ws}` },
]

export const PURGE_CASCADED = ['bauherren_rels', 'payload_locked_documents_rels']

const unlinkPeople = async (payload: Payload, ws: number, req: Awaited<ReturnType<typeof createLocalReq>>): Promise<void> => {
  const people = (await payload.find({ collection: 'bauherren', where: { or: [{ 'tenants.tenant': { equals: ws } }, { 'assignments.workspace': { equals: ws } }] }, pagination: false, depth: 0, overrideAccess: true, req })).docs as Doc[]
  for (const u of people) {
    const data: Doc = { tenants: (u.tenants ?? []).map((t: Doc) => ({ tenant: t.tenant })).filter((t: Doc) => t.tenant !== ws) }
    if (u.assignments?.length) data.assignments = u.assignments.filter((a: Doc) => a.workspace !== ws)
    await payload.update({ collection: 'bauherren', id: u.id, data, overrideAccess: true, depth: 0, req })
  }
}

export const purgeWorkspace = async (payload: Payload, workspace: number, now = new Date()): Promise<boolean> => {
  const req = await createLocalReq({}, payload)
  const txId = await payload.db.beginTransaction()
  if (!txId) throw new Error('database transactions unavailable')
  req.transactionID = txId
  const tx = (payload.db as unknown as { sessions: Record<string, { db: Exec }> }).sessions[await txId]!.db
  let slug = ''
  try {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ARCHIVE_LOCK}))`)
    const ws = (await tx.execute(sql`SELECT "id", "slug", "name" FROM "workspaces" WHERE "id" = ${workspace} AND "archived_at" IS NOT NULL AND "purge_at" <= ${now.toISOString()}`)).rows[0] as { id: number; slug: string; name: string } | undefined
    if (!ws) {
      await payload.db.rollbackTransaction(txId)
      return false
    }
    slug = ws.slug
    await unlinkPeople(payload, workspace, req)
    await tx.execute(sql`UPDATE "human_touches" SET "workspace_id" = NULL WHERE "workspace_id" = ${workspace} AND "kind" LIKE 'workspace:%'`)
    await tx.execute(sql`UPDATE "workspaces" SET "knowledge_connection_id" = NULL WHERE "id" = ${workspace}`)
    for (const { table, where } of PURGE_ORDER) await tx.execute(sql`DELETE FROM ${sql.identifier(table)} WHERE ${where(workspace)}`)
    await tx.execute(sql`INSERT INTO "human_touches" ("kind", "actor", "at", "detail", "updated_at", "created_at") VALUES ('workspace:purge', 'system', now(), ${JSON.stringify({ id: ws.id, slug: ws.slug, name: ws.name })}::jsonb, now(), now())`)
    await payload.db.commitTransaction(txId)
  } catch (e) {
    await payload.db.rollbackTransaction(txId)
    throw e
  }
  if (gatewayEnabled()) {
    await removeWorkspaceProviders(slug).catch((err) => payload.logger.error({ err, slug }, 'workspace purged; provider files not removed'))
    await renderModels(await createLocalReq({}, payload)).catch((err) => payload.logger.error({ err, slug }, 'workspace purged; gateway models not re-rendered'))
  }
  return true
}

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
