import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let del: typeof import('../src/lib/workspace-delete')
let wsA: number
let wsB: number
let admin: Doc
let member: Doc
const o = { overrideAccess: true } as const

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('workspace_delete')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  del = await import('../src/lib/workspace-delete')
  const seed = async (slug: string) => {
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o }))
      .id as number
    const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o }))
      .id as number
    return { workspace, product }
  }
  wsA = (await seed('alpha')).workspace
  wsB = (await seed('beta')).workspace
  admin = await payload.create({
    collection: 'bauherren',
    data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', tenants: [{ tenant: wsA }, { tenant: wsB }] },
    ...o,
  })
  member = await payload.create({
    collection: 'bauherren',
    data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: wsA }, { tenant: wsB }] },
    ...o,
  })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.GATEWAY_ADMIN_URL
  await payload?.destroy()
  await testDb?.drop(payload)
})

const rows = async (q: ReturnType<typeof sql>) => (await payload.db.drizzle.execute(q)).rows as Doc[]

it('archive refuses a non-Admin and refuses the last live Workspace', async () => {
  await expect(del.archiveWorkspace(payload, member, wsB)).rejects.toThrow('Only an Admin')
  await expect(del.archiveWorkspace(payload, admin, 999_999)).rejects.toThrow('not found')
  const lone = (await payload.create({ collection: 'workspaces', data: { name: 'lone', slug: 'lone' }, ...o }))
    .id as number
  await rows(sql`UPDATE "workspaces" SET "archived_at" = now() WHERE "id" IN (${wsA}, ${wsB})`)
  await expect(del.archiveWorkspace(payload, admin, lone)).rejects.toThrow('last Workspace')
  await rows(sql`UPDATE "workspaces" SET "archived_at" = NULL WHERE "id" IN (${wsA}, ${wsB})`)
  await payload.delete({ collection: 'workspaces', id: lone, ...o })
  expect(await rows(sql`SELECT 1 FROM "workspaces" WHERE "archived_at" IS NOT NULL`)).toHaveLength(0)
})

it('archive stops the Workspace at once', async () => {
  const session = (
    await rows(
      sql`INSERT INTO "agent_sessions" ("workspace_id", "public_id", "owner_id", "role", "connected_at",
        "last_seen_at") VALUES (${wsB}, 'ses_x', ${member.id}, 'engineer', now(), now()) RETURNING "id"`,
    )
  )[0]
  expect(((await payload.findByID({ collection: 'workspaces', id: wsB, ...o })) as Doc).gatewayKey).toBeTruthy()

  const deleted: string[] = []
  process.env.GATEWAY_ADMIN_URL = 'http://gw.test'
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const res = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (init?.method === 'DELETE') return (deleted.push(url), res({}))
    return res({
      resources: ['workspace-beta', 'workspace-beta-session', 'workspace-alpha'].map((name) => ({
        id: name,
        value: { key: 'k', metadata: { name } },
      })),
    })
  })
  await del.archiveWorkspace(payload, admin, wsB, new Date('2026-11-13T10:00:00Z'))
  vi.unstubAllGlobals()
  delete process.env.GATEWAY_ADMIN_URL

  expect(deleted.map((u) => u.split('/').pop()).sort()).toEqual(['workspace-beta', 'workspace-beta-session'])
  const ws = (await rows(sql`SELECT * FROM "workspaces" WHERE "id" = ${wsB}`))[0]
  expect(new Date(ws.archived_at).toISOString()).toBe('2026-11-13T10:00:00.000Z')
  expect(new Date(ws.purge_at).toISOString()).toBe('2026-11-27T10:00:00.000Z')
  expect(ws.gateway_key).toBeNull()
  expect(
    (await rows(sql`SELECT "disconnected_at" FROM "agent_sessions" WHERE "id" = ${session.id}`))[0].disconnected_at,
  ).not.toBeNull()
  const touches = await rows(sql`SELECT * FROM "human_touches" WHERE "kind" = 'workspace:delete'`)
  expect(touches).toHaveLength(1)
  expect(touches[0]).toMatchObject({
    workspace_id: null,
    actor: 'a@x.io',
    detail: { id: wsB, slug: 'beta', name: 'beta' },
  })
})

it('an archived Workspace is hidden from workspacesOf', async () => {
  const { workspacesOf } = await import('../src/app/(app)/lib/session')
  expect((await workspacesOf(admin as never)).map((w) => w.id)).toEqual([wsA])
  expect((await workspacesOf(member as never)).map((w) => w.id)).toEqual([wsA])
  expect(await del.isArchived(payload, wsB)).toBe(true)
  expect(await del.isArchived(payload, wsA)).toBe(false)
})

it('restore works before purgeAt, clears both fields and writes workspace:restore; keys are not restored', async () => {
  await expect(del.restoreWorkspace(payload, member, wsB)).rejects.toThrow('Only an Admin')
  await expect(del.restoreWorkspace(payload, admin, wsA)).rejects.toThrow('cannot be restored')
  await expect(del.restoreWorkspace(payload, admin, wsB, new Date('2026-11-27T10:00:01Z'))).rejects.toThrow(
    'cannot be restored',
  )
  expect((await del.archivedWorkspaces(payload)).map((w) => w.id)).toEqual([wsB])
  await del.restoreWorkspace(payload, admin, wsB, new Date('2026-11-20T10:00:00Z'))
  const ws = (await rows(sql`SELECT * FROM "workspaces" WHERE "id" = ${wsB}`))[0]
  expect([ws.archived_at, ws.purge_at, ws.gateway_key]).toEqual([null, null, null])
  const touches = await rows(sql`SELECT * FROM "human_touches" WHERE "kind" = 'workspace:restore'`)
  expect(touches).toHaveLength(1)
  expect(touches[0]).toMatchObject({ workspace_id: wsB, actor: 'a@x.io', detail: { id: wsB, slug: 'beta' } })
  const { workspacesOf } = await import('../src/app/(app)/lib/session')
  expect((await workspacesOf(admin as never)).map((w) => w.id).sort()).toEqual([wsA, wsB].sort())
})
