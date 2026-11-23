import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { anyRow, countRow, queryRows } from './helpers/query-rows'
import { bootPurgeDb, type PurgeDb } from './helpers/workspace-purge'

let db: PurgeDb
let payload: Payload
let del: PurgeDb['del']
let wsA: number
let wsB: number
let memberId: number
let snapB: Record<string, number>
const o = { overrideAccess: true } as const
const rows = (q: ReturnType<typeof sql>) => queryRows(payload, anyRow, q)
const count = async (q: ReturnType<typeof sql>) => (await queryRows(payload, countRow, q))[0].n
const tenantIds = (doc: Record<string, unknown>): number[] =>
  z
    .array(z.object({ tenant: z.number() }))
    .parse(doc.tenants)
    .map((t) => t.tenant)
const auditRow = z.object({ kind: z.string(), workspace_id: z.number().nullable(), detail: z.unknown() })
const column = z.object({
  column_name: z.string(),
  data_type: z.string(),
  udt_name: z.string(),
  is_nullable: z.string(),
  column_default: z.string().nullable(),
})
type Column = z.infer<typeof column>
const day = 86_400_000
const archivedAt = new Date('2026-11-01T00:00:00Z')
const purgeAt = new Date(archivedAt.getTime() + 14 * day)
const after = new Date(purgeAt.getTime() + 1000)

const enumLabel = z.object({ enumlabel: z.string() })
const idRow = z.object({ id: z.number() })

const needsValue = (c: Column, data: Record<string, unknown>) =>
  !(c.column_name in data || c.is_nullable === 'YES' || c.column_default !== null)

const valueFor = async (c: Column, n: number): Promise<unknown> => {
  if (c.data_type === 'USER-DEFINED')
    return (
      await queryRows(
        payload,
        enumLabel,
        sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = ${c.udt_name}
          ORDER BY e.enumsortorder LIMIT 1`,
      )
    )[0].enumlabel
  if (/int|numeric|double|real/.test(c.data_type)) return n
  if (c.data_type === 'boolean') return false
  if (/timestamp/.test(c.data_type)) return new Date().toISOString()
  if (/json/.test(c.data_type)) return '{}'
  return `x${n}`
}

let n = 0
const seed = async (table: string, values: Record<string, unknown> = {}): Promise<number> => {
  const cols = await queryRows(
    payload,
    column,
    sql`SELECT column_name, data_type, udt_name, is_nullable, column_default FROM information_schema.columns WHERE
      table_schema = 'public' AND table_name = ${table}`,
  )
  const data: Record<string, unknown> = { ...values }
  for (const c of cols.filter((col) => needsValue(col, data))) {
    n++
    data[c.column_name] = await valueFor(c, n)
  }
  const keys = Object.keys(data)
  const cols_ = sql.join(
    keys.map((k) => sql.identifier(k)),
    sql`, `,
  )
  const vals = sql.join(
    keys.map((k) => sql`${data[k]}`),
    sql`, `,
  )
  const inserted = await queryRows(
    payload,
    idRow,
    sql`INSERT INTO ${sql.identifier(table)} (${cols_}) VALUES (${vals}) RETURNING *`,
  )
  return inserted[0].id
}

const seedWorkspace = async (slug: string, owner: number) => {
  const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o }))
    .id as number
  const connection = (
    await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })
  ).id as number
  await payload.create({
    collection: 'ticket_sources',
    data: { repo: `acme/${slug}`, product, connection, workspace },
    ...o,
  })
  await rows(sql`UPDATE "workspaces" SET "knowledge_connection_id" = ${connection} WHERE "id" = ${workspace}`)
  await seed('repositories', { workspace_id: workspace, product_id: product })
  await seed('knowledge_chunks', { workspace_id: workspace })
  const record = await seed('records', { workspace_id: workspace, product_id: product })
  const stageRun = await seed('stage_runs', { workspace_id: workspace, record_id: record })
  const attachment = await seed('attachments', { workspace_id: workspace, record_id: record, run_id: stageRun })
  await seed('proofs', { workspace_id: workspace, record_id: record, attachment_id: attachment })
  await seed('agent_sessions', { workspace_id: workspace, owner_id: owner })
  await seed('human_touches', { workspace_id: workspace })
  await seed('human_touches', {
    workspace_id: workspace,
    kind: 'workspace:restore',
    detail: JSON.stringify({ id: workspace, slug, name: slug }),
  })
  return { workspace, product }
}

const tables = () => del.PURGE_ORDER.map((p) => p.table).filter((t) => t !== 'workspaces')
const counts = async (): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      [...tables(), 'workspaces', 'bauherren', 'bauherren_rels'].map(async (t): Promise<[string, number]> => [
        t,
        await count(sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)}`),
      ]),
    ),
  )
const archive = (id: number, at = purgeAt) =>
  rows(
    sql`UPDATE "workspaces" SET "archived_at" = ${archivedAt.toISOString()}, "purge_at" = ${at.toISOString()} WHERE
      "id" = ${id}`,
  )

beforeAll(async () => {
  db = await bootPurgeDb('workspace_purge')
  ;({ payload, del } = db)
  const member = await payload.create({
    collection: 'bauherren',
    data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr' },
    ...o,
  })
  memberId = member.id as number
  const b = await seedWorkspace('beta', memberId)
  wsB = b.workspace
  snapB = await counts()
  const a = await seedWorkspace('alpha', memberId)
  wsA = a.workspace
  await rows(sql`UPDATE "bauherren" SET "updated_at" = now() WHERE "id" = ${memberId}`)
  await payload.update({
    collection: 'bauherren',
    id: memberId,
    data: { tenants: [{ tenant: wsA }, { tenant: wsB }] },
    ...o,
  })
  await payload.create({
    collection: 'bauherren',
    data: {
      email: 'po@x.io',
      password: 'pw-123456',
      role: 'product-owner',
      assignments: [
        { workspace: wsA, scope: 'products', products: [a.product] },
        { workspace: wsB, scope: 'products', products: [b.product] },
      ],
    },
    ...o,
  })
  snapB.bauherren_rels = await count(
    sql`SELECT count(*)::int AS n FROM "bauherren_rels" WHERE "products_id" = ${b.product}`,
  )
})

afterAll(async () => {
  vi.restoreAllMocks()
  await payload?.destroy()
  await db?.testDb?.drop(payload)
})

it('never purges a Workspace that is not archived, or not yet due', async () => {
  const before = await counts()
  expect(await del.purgeWorkspace(payload, wsA, after)).toBe(false)
  await archive(wsA)
  expect(await del.purgeWorkspace(payload, wsA, new Date(purgeAt.getTime() - 1000))).toBe(false)
  expect(await del.purgeDueWorkspaces(payload, new Date(purgeAt.getTime() - 1000))).toEqual([])
  expect(await counts()).toEqual(before)
})

it(
  'a Restore that wins the lock first leaves every row; a Restore ' + 'after the lock is held by the purge waits',
  async () => {
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
  },
)

it('an error rolls the whole purge back and the next run retries', async () => {
  const before = await counts()
  await rows(
    sql`CREATE FUNCTION purge_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$ LANGUAGE plpgsql`,
  )
  await rows(sql`CREATE TRIGGER purge_fail BEFORE DELETE ON "workspaces" FOR EACH ROW EXECUTE FUNCTION purge_fail()`)
  await expect(del.purgeWorkspace(payload, wsA, after)).rejects.toThrow('DELETE FROM "workspaces"')
  const err = vi.spyOn(payload.logger, 'error')
  expect(await del.purgeDueWorkspaces(payload, after)).toEqual([])
  expect(err).toHaveBeenCalled()
  expect(await counts()).toEqual(before)
  expect((await payload.findByID({ collection: 'bauherren', id: memberId, ...o })).tenants).toHaveLength(2)
  await rows(sql`DROP TRIGGER purge_fail ON "workspaces"`)
  await rows(sql`DROP FUNCTION purge_fail()`)
})

it('purges every row of the archived Workspace and none of the other; people and audit rows stay', async () => {
  const people = await count(sql`SELECT count(*)::int AS n FROM "bauherren"`)
  const err = vi.spyOn(payload.logger, 'error')
  expect(await del.purgeDueWorkspaces(payload, after)).toEqual([wsA])

  const now = await counts()
  for (const t of Object.keys(snapB).filter(
    (k) => !['bauherren', 'bauherren_rels', 'human_touches', 'bauherren_assignments', 'bauherren_tenants'].includes(k),
  ))
    expect(now[t], t).toBe(snapB[t])
  expect(await rows(sql`SELECT 1 FROM "workspaces" WHERE "id" = ${wsA}`)).toHaveLength(0)
  expect([now.attachments, now.proofs]).toEqual([1, 1])
  expect(await rows(sql`SELECT 1 FROM "attachments" WHERE "workspace_id" = ${wsA}`)).toHaveLength(0)
  expect(now.bauherren).toBe(people)
  expect(await rows(sql`SELECT 1 FROM "bauherren_tenants" WHERE "tenant_id" = ${wsA}`)).toHaveLength(0)
  expect(await rows(sql`SELECT 1 FROM "bauherren_assignments" WHERE "workspace_id" = ${wsA}`)).toHaveLength(0)
  expect(await rows(sql`SELECT 1 FROM "bauherren_assignments" WHERE "workspace_id" = ${wsB}`)).toHaveLength(1)
  expect(tenantIds(await payload.findByID({ collection: 'bauherren', id: memberId, depth: 0, ...o }))).toEqual([wsB])
  const po = await payload.find({ collection: 'bauherren', where: { email: { equals: 'po@x.io' } }, depth: 0, ...o })
  expect(tenantIds(po.docs[0])).toEqual([wsB])

  expect(await count(sql`SELECT count(*)::int AS n FROM "human_touches" WHERE "workspace_id" = ${wsB}`)).toBe(
    snapB.human_touches,
  )
  const audit = await queryRows(
    payload,
    auditRow,
    sql`SELECT "kind", "workspace_id", "detail" FROM "human_touches" WHERE "kind" LIKE 'workspace:%' AND "workspace_id"
      IS NULL ORDER BY "id"`,
  )
  expect(audit.map((a) => a.kind)).toEqual(['workspace:restore', 'workspace:purge'])
  expect(audit[1].detail).toMatchObject({ id: wsA, slug: 'alpha', name: 'alpha' })

  expect(err).not.toHaveBeenCalled()
})
