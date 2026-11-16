import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let del: typeof import('../src/lib/workspace-delete')
let testDb: TestDb
let wsA: number
let wsB: number
let member: Doc
let snapB: Record<string, number>
const o = { overrideAccess: true } as const
const mediaDir = process.env.MEDIA_DIR!
const rows = async (q: ReturnType<typeof sql>) => (await payload.db.drizzle.execute(q)).rows as Doc[]
const day = 86_400_000
const archivedAt = new Date('2026-11-01T00:00:00Z')
const purgeAt = new Date(archivedAt.getTime() + 14 * day)
const after = new Date(purgeAt.getTime() + 1000)

let n = 0
/** Inserts one row; every NOT NULL column without a default that `values` leaves out is filled by its type. Returns the id. */
const seed = async (table: string, values: Record<string, unknown> = {}): Promise<number> => {
  const cols = await rows(sql`SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${table}`)
  const data: Record<string, unknown> = { ...values }
  for (const c of cols) {
    if (c.column_name in data || c.is_nullable === 'YES' || c.column_default !== null) continue
    n++
    if (c.data_type === 'USER-DEFINED') data[c.column_name] = (await rows(sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${c.udt_name} ORDER BY e.enumsortorder LIMIT 1`))[0].enumlabel
    else if (/int|numeric|double|real/.test(c.data_type)) data[c.column_name] = n
    else if (c.data_type === 'boolean') data[c.column_name] = false
    else if (/timestamp/.test(c.data_type)) data[c.column_name] = new Date().toISOString()
    else if (/json/.test(c.data_type)) data[c.column_name] = '{}'
    else data[c.column_name] = `x${n}`
  }
  const keys = Object.keys(data)
  const cols_ = sql.join(keys.map((k) => sql.identifier(k)), sql`, `)
  const vals = sql.join(keys.map((k) => sql`${data[k]}`), sql`, `)
  return (await rows(sql`INSERT INTO ${sql.identifier(table)} (${cols_}) VALUES (${vals}) RETURNING *`))[0].id as number
}

/** One Workspace with a row in every table of `PURGE_ORDER` (plus media files on disk). */
const seedWorkspace = async (slug: string, owner: number) => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode: 'session', wipLimits: {} }, ...o })).id as number
  const w = { workspace }
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: `acme/${slug}`, product, connection, workspace }, ...o })
  const version = await seed('workflow_versions', { workspace_id: workspace, product_id: product })
  await rows(sql`UPDATE "workspaces" SET "workflow_version_id" = ${version}, "knowledge_connection_id" = ${connection} WHERE "id" = ${workspace}`)
  await seed('repositories', { workspace_id: workspace, product_id: product })
  await seed('templates', { workspace_id: workspace })
  await seed('knowledge_chunks', { workspace_id: workspace })
  const t1 = await seed('tickets', { workspace_id: workspace, product_id: product })
  const t2 = await seed('tickets', { workspace_id: workspace, product_id: product, parent_id: t1, inherited_approval_from_id: t1 })
  await seed('tickets_rels', { parent_id: t1, tickets_id: t2, path: 'blockedBy', order: 1 })
  await seed('tickets_texts', { parent_id: t1, path: 'labels', order: 1 })
  const intake = await seed('intake_sessions', { workspace_id: workspace, product_id: product })
  await seed('intake_sessions', { workspace_id: workspace, product_id: product, follow_up_of_id: intake })
  await seed('embed_tokens', { workspace_id: workspace, product_id: product })
  const thread = await seed('chat_threads', { workspace_id: workspace, ticket_id: t1, intake_session_id: intake, owner_id: owner })
  await seed('chat_messages', { workspace_id: workspace, thread_id: thread })
  const session = await seed('agent_sessions', { workspace_id: workspace, owner_id: owner })
  const run0 = await seed('runs', { workspace_id: workspace, ticket_id: t1, session_id: session })
  const run = await seed('runs', { workspace_id: workspace, ticket_id: t1, session_id: session, previous_run_id: run0 })
  const step = await seed('steps', { workspace_id: workspace, run_id: run })
  await seed('tool_calls', { workspace_id: workspace, run_id: run, step_id: step })
  await seed('session_spans', { workspace_id: workspace, run_id: run, session_id: session, ticket_id: t1 })
  await seed('usage_entries', { workspace_id: workspace, run_id: run, session_id: session, ticket_id: t1 })
  await seed('usage_cursors', { workspace_id: workspace, session_id: session })
  const file = `${slug}.png`
  mkdirSync(mediaDir, { recursive: true })
  writeFileSync(join(mediaDir, file), 'png')
  const media = await seed('media', { workspace_id: workspace, product_id: product, session_id: intake, filename: file })
  await seed('artifacts', { workspace_id: workspace, ticket_id: t1, run_id: run, media_id: media })
  await seed('skill_proposals', { workspace_id: workspace, ticket_id: t1, run_id: run })
  await seed('ticket_events', { workspace_id: workspace, ticket_id: t1, run_id: run })
  await seed('check_flakes', { workspace_id: workspace, ticket_id: t1 })
  await seed('human_touches', { workspace_id: workspace, ticket_id: t1, run_id: run })
  await seed('human_touches', { workspace_id: workspace, kind: 'workspace:restore', detail: JSON.stringify({ id: workspace, slug, name: slug }) })
  return { ...w, product, file }
}

const tables = () => del.PURGE_ORDER.map((p) => p.table).filter((t) => t !== 'workspaces')
const counts = async (): Promise<Record<string, number>> =>
  Object.fromEntries(await Promise.all([...tables(), 'workspaces', 'bauherren', 'bauherren_rels'].map(async (t) => [t, (await rows(sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)}`))[0].n as number])))
const archive = (id: number, at = purgeAt) => rows(sql`UPDATE "workspaces" SET "archived_at" = ${archivedAt.toISOString()}, "purge_at" = ${at.toISOString()} WHERE "id" = ${id}`)

beforeAll(async () => {
  testDb = await createTestDb('workspace_purge')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  del = await import('../src/lib/workspace-delete')
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr' }, ...o })
  const b = await seedWorkspace('beta', member.id)
  wsB = b.workspace
  snapB = await counts()
  const a = await seedWorkspace('alpha', member.id)
  wsA = a.workspace
  mkdirSync(join(mediaDir, 'stuck'), { recursive: true })
  writeFileSync(join(mediaDir, 'stuck', 'f'), 'x')
  await seed('media', { workspace_id: wsA, filename: 'stuck' })
  await rows(sql`UPDATE "bauherren" SET "updated_at" = now() WHERE "id" = ${member.id}`)
  await payload.update({ collection: 'bauherren', id: member.id, data: { tenants: [{ tenant: wsA }, { tenant: wsB }] }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'po@x.io', password: 'pw-123456', role: 'product-owner', assignments: [{ workspace: wsA, scope: 'products', products: [a.product] }, { workspace: wsB, scope: 'products', products: [b.product] }] }, ...o })
  snapB.bauherren_rels = (await rows(sql`SELECT count(*)::int AS n FROM "bauherren_rels" WHERE "products_id" = ${b.product}`))[0].n
})

afterAll(async () => {
  vi.restoreAllMocks()
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('never purges a Workspace that is not archived, or not yet due', async () => {
  const before = await counts()
  expect(await del.purgeWorkspace(payload, wsA, after)).toBe(false)
  await archive(wsA)
  expect(await del.purgeWorkspace(payload, wsA, new Date(purgeAt.getTime() - 1000))).toBe(false)
  expect(await del.purgeDueWorkspaces(payload, new Date(purgeAt.getTime() - 1000))).toEqual([])
  expect(await counts()).toEqual(before)
})

it('a Restore that wins the lock first leaves every row; a Restore after the lock is held by the purge waits', async () => {
  const before = await counts()
  const db = payload.db.drizzle
  let release!: () => void
  const holding = new Promise<void>((r) => (release = r))
  let locked!: () => void
  const gotLock = new Promise<void>((r) => (locked = r))
  const tx = db.transaction(async (t: typeof db) => {
    await t.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${del.ARCHIVE_LOCK}))`)
    locked()
    await holding
    await t.execute(sql`UPDATE "workspaces" SET "archived_at" = NULL, "purge_at" = NULL WHERE "id" = ${wsA}`)
  })
  await gotLock
  let done = false
  const purge = del.purgeWorkspace(payload, wsA, after).then((r) => ((done = true), r))
  await new Promise((r) => setTimeout(r, 400))
  expect(done).toBe(false)
  release()
  await tx
  expect(await purge).toBe(false)
  expect(await counts()).toEqual(before)
  await archive(wsA)
})

it('an error rolls the whole purge back, keeps media files, and the next run retries', async () => {
  const before = await counts()
  await rows(sql`CREATE FUNCTION purge_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$ LANGUAGE plpgsql`)
  await rows(sql`CREATE TRIGGER purge_fail BEFORE DELETE ON "workspaces" FOR EACH ROW EXECUTE FUNCTION purge_fail()`)
  await expect(del.purgeWorkspace(payload, wsA, after)).rejects.toThrow('DELETE FROM "workspaces"')
  const err = vi.spyOn(payload.logger, 'error')
  expect(await del.purgeDueWorkspaces(payload, after)).toEqual([])
  expect(err).toHaveBeenCalled()
  expect(await counts()).toEqual(before)
  expect((await payload.findByID({ collection: 'bauherren', id: member.id, ...o })).tenants).toHaveLength(2)
  expect(existsSync(join(mediaDir, 'alpha.png'))).toBe(true)
  await rows(sql`DROP TRIGGER purge_fail ON "workspaces"`)
  await rows(sql`DROP FUNCTION purge_fail()`)
})

it('purges every row of the archived Workspace and none of the other; people and audit rows stay', async () => {
  const people = (await rows(sql`SELECT count(*)::int AS n FROM "bauherren"`))[0].n
  const err = vi.spyOn(payload.logger, 'error')
  expect(await del.purgeDueWorkspaces(payload, after)).toEqual([wsA])

  const now = await counts()
  for (const t of Object.keys(snapB).filter((k) => !['bauherren', 'bauherren_rels', 'human_touches', 'bauherren_assignments', 'bauherren_tenants'].includes(k))) expect(now[t], t).toBe(snapB[t])
  expect(await rows(sql`SELECT 1 FROM "workspaces" WHERE "id" = ${wsA}`)).toHaveLength(0)
  expect(now.bauherren).toBe(people)
  expect(await rows(sql`SELECT 1 FROM "bauherren_tenants" WHERE "tenant_id" = ${wsA}`)).toHaveLength(0)
  expect(await rows(sql`SELECT 1 FROM "bauherren_assignments" WHERE "workspace_id" = ${wsA}`)).toHaveLength(0)
  expect(await rows(sql`SELECT 1 FROM "bauherren_assignments" WHERE "workspace_id" = ${wsB}`)).toHaveLength(1)
  expect(((await payload.findByID({ collection: 'bauherren', id: member.id, depth: 0, ...o })).tenants as Doc[]).map((t) => t.tenant)).toEqual([wsB])
  const po = (await payload.find({ collection: 'bauherren', where: { email: { equals: 'po@x.io' } }, depth: 0, ...o })).docs[0] as Doc
  expect(po.tenants.map((t: Doc) => t.tenant)).toEqual([wsB])

  expect((await rows(sql`SELECT count(*)::int AS n FROM "human_touches" WHERE "workspace_id" = ${wsB}`))[0].n).toBe(snapB.human_touches)
  const audit = await rows(sql`SELECT "kind", "workspace_id", "detail" FROM "human_touches" WHERE "kind" LIKE 'workspace:%' AND "workspace_id" IS NULL ORDER BY "id"`)
  expect(audit.map((a) => a.kind)).toEqual(['workspace:restore', 'workspace:purge'])
  expect(audit[1].detail).toMatchObject({ id: wsA, slug: 'alpha', name: 'alpha' })

  expect(existsSync(join(mediaDir, 'alpha.png'))).toBe(false)
  expect(existsSync(join(mediaDir, 'beta.png'))).toBe(true)
  expect(err).toHaveBeenCalledWith(expect.objectContaining({ file: 'stuck' }), expect.stringContaining('media file not deleted'))
})

it('every table that reaches a Workspace, Ticket or Product is covered by the purge, children before parents', async () => {
  const fks = await rows(sql`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, c.confdeltype AS del FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`)
  const reach = new Set(['workspaces'])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of fks) if (reach.has(f.parent) && !reach.has(f.child)) reach.add(f.child), (grew = true)
  }
  const order = del.PURGE_ORDER.map((p) => p.table)
  const uncovered = [...reach].filter((t) => !order.includes(t) && !del.PURGE_CASCADED.includes(t))
  expect(uncovered, 'tables pointing at a Workspace without purge coverage: add them to PURGE_ORDER in lib/workspace-delete.ts').toEqual([])
  expect(order.filter((t) => !reach.has(t))).toEqual([])
  const loose = await rows(sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name ILIKE '%workspace%' AND table_name NOT IN (SELECT unnest(${`{${[...reach].join(',')}}`}::text[]))`)
  expect(loose, 'a column naming a Workspace without a foreign key: purge it by hand').toEqual([])
  for (const t of del.PURGE_CASCADED) expect(fks.filter((f) => f.child === t && reach.has(f.parent)).every((f) => f.del === 'c'), `${t} must cascade`).toBe(true)
  // The Workspace row's own references (workflow version, knowledge Connection) are cleared before the deletes.
  for (const f of fks) {
    if (f.del === 'c' || f.child === f.parent || f.child === 'workspaces' || !order.includes(f.child) || !order.includes(f.parent)) continue
    expect(order.indexOf(f.child), `${f.child} must be deleted before ${f.parent}`).toBeLessThan(order.indexOf(f.parent))
  }
})
