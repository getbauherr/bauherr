import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let fake: FakeBackend
let jobs: typeof import('../src/jobs')
let del: typeof import('../src/lib/workspace-delete')
let wsA: number
let wsB: number
let admin: Doc
let member: Doc
let call: (user: Doc, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repoA = 'acme/a'
const repoB = 'acme/b'

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('workspace_delete')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  del = await import('../src/lib/workspace-delete')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  const seed = async (slug: string, repo: string) => {
    const workspace = (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode: 'session', wipLimits: {} }, ...o })).id as number
    const product = (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id as number
    const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
    await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace }, ...o })
    return { workspace, product }
  }
  wsA = (await seed('alpha', repoA)).workspace
  wsB = (await seed('beta', repoB)).workspace
  admin = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', tenants: [{ tenant: wsA }, { tenant: wsB }] }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: wsA }, { tenant: wsB }] }, ...o })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.GATEWAY_ADMIN_URL
  await payload?.destroy()
  await testDb?.drop(payload)
})

const rows = async (q: ReturnType<typeof sql>) => (await payload.db.drizzle.execute(q)).rows as Doc[]
const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const ticketIn = (workspace: number, product: number, n: number) =>
  payload.create({ collection: 'tickets', data: { title: `t${n}`, externalId: `w${workspace}-${n}`, number: n, state: 'open', labels: [], workspace, product }, ...o }) as Promise<Doc>

it('archive refuses a non-Admin and refuses the last live Workspace', async () => {
  await expect(del.archiveWorkspace(payload, member, wsB)).rejects.toThrow('Only an Admin')
  await expect(del.archiveWorkspace(payload, admin, 999_999)).rejects.toThrow('not found')
  const lone = (await payload.create({ collection: 'workspaces', data: { name: 'lone', slug: 'lone' }, ...o })).id as number
  await rows(sql`UPDATE "workspaces" SET "archived_at" = now() WHERE "id" IN (${wsA}, ${wsB})`)
  await expect(del.archiveWorkspace(payload, admin, lone)).rejects.toThrow('last Workspace')
  await rows(sql`UPDATE "workspaces" SET "archived_at" = NULL WHERE "id" IN (${wsA}, ${wsB})`)
  await payload.delete({ collection: 'workspaces', id: lone, ...o })
  expect(await rows(sql`SELECT 1 FROM "workspaces" WHERE "archived_at" IS NOT NULL`)).toHaveLength(0)
})

let archivedAt: Date
it('archive stops the Workspace at once', async () => {
  const productB = (await payload.find({ collection: 'products', where: { workspace: { equals: wsB } }, limit: 1, ...o })).docs[0].id as number
  const t = await ticketIn(wsB, productB, 1001)
  const run = (status: string) => payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', mode: 'session', status, workspace: wsB }, ...o }) as Promise<Doc>
  const [queued, awaiting, running, done] = [await run('queued'), await run('awaiting_session'), await run('running'), await run('succeeded')]
  const session = (await rows(sql`INSERT INTO "agent_sessions" ("workspace_id", "public_id", "owner_id", "role", "connected_at", "last_seen_at") VALUES (${wsB}, 'ses_x', ${member.id}, 'engineer', now(), now()) RETURNING "id"`))[0]
  const embed = await payload.create({ collection: 'embed_tokens', data: { name: 'w', product: productB, tokenHash: 'h1', workspace: wsB }, ...o })
  await rows(sql`UPDATE "workspaces" SET "router_key" = 'enc-router' WHERE "id" = ${wsB}`)
  expect(((await payload.findByID({ collection: 'workspaces', id: wsB, ...o })) as Doc).gatewayKey).toBeTruthy()

  const deleted: string[] = []
  process.env.GATEWAY_ADMIN_URL = 'http://gw.test'
  vi.stubGlobal('fetch', async (url: string, init?: { method?: string }) => {
    const res = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
    if (init?.method === 'DELETE') return deleted.push(url), res({})
    return res({ resources: ['workspace-beta', 'workspace-beta-session', 'workspace-beta-router', 'workspace-alpha'].map((name) => ({ id: name, value: { key: 'k', metadata: { name } } })) })
  })
  archivedAt = new Date('2026-11-13T10:00:00Z')
  await del.archiveWorkspace(payload, admin, wsB, archivedAt)
  vi.unstubAllGlobals()
  delete process.env.GATEWAY_ADMIN_URL

  expect(deleted.map((u) => u.split('/').pop()).sort()).toEqual(['workspace-beta', 'workspace-beta-router', 'workspace-beta-session'])
  const ws = (await rows(sql`SELECT * FROM "workspaces" WHERE "id" = ${wsB}`))[0]
  expect(new Date(ws.archived_at).toISOString()).toBe('2026-11-13T10:00:00.000Z')
  expect(new Date(ws.purge_at).toISOString()).toBe('2026-11-27T10:00:00.000Z')
  expect([ws.gateway_key, ws.router_key]).toEqual([null, null])
  const status = async (id: number) => ((await payload.findByID({ collection: 'runs', id, ...o })) as Doc)
  for (const r of [queued, awaiting, running]) expect(await status(r.id)).toMatchObject({ status: 'cancelled', error: 'Workspace deleted' })
  expect((await status(done.id)).status).toBe('succeeded')
  expect((await rows(sql`SELECT "disconnected_at" FROM "agent_sessions" WHERE "id" = ${session.id}`))[0].disconnected_at).not.toBeNull()
  expect(((await payload.findByID({ collection: 'embed_tokens', id: embed.id, ...o })) as Doc).revokedAt).toBeTruthy()
  const touches = await rows(sql`SELECT * FROM "human_touches" WHERE "kind" = 'workspace:delete'`)
  expect(touches).toHaveLength(1)
  expect(touches[0]).toMatchObject({ workspace_id: null, actor: 'a@x.io', detail: { id: wsB, slug: 'beta', name: 'beta' } })
})

it('an archived Workspace is hidden from workspacesOf, MCP connect, the poller and the triage sweep', async () => {
  const { workspacesOf } = await import('../src/app/(app)/lib/session')
  expect((await workspacesOf(admin as never)).map((w) => w.id)).toEqual([wsA])
  expect((await workspacesOf(member as never)).map((w) => w.id)).toEqual([wsA])
  await expect(call(member, 'connect', { role: 'engineer', workspace: 'beta' })).rejects.toThrow('Workspace deleted')

  const productB = (await payload.find({ collection: 'products', where: { workspace: { equals: wsB } }, limit: 1, ...o })).docs[0].id as number
  const productA = (await payload.find({ collection: 'products', where: { workspace: { equals: wsA } }, limit: 1, ...o })).docs[0].id as number
  const issueB = await fake.tickets(repoB).create({ title: 'b', labels: [] })
  const issueA = await fake.tickets(repoA).create({ title: 'a', labels: [] })
  await poll()
  const byNumber = async (workspace: number, number: number) => (await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { number: { equals: number } }] }, depth: 0, ...o })).docs
  expect(await byNumber(wsA, issueA.number)).toHaveLength(1)
  expect(await byNumber(wsB, issueB.number)).toHaveLength(0)

  const stuck = await ticketIn(wsB, productB, 90)
  const live = await ticketIn(wsA, productA, 91)
  await jobs.triageSweep(payload)
  const runsOf = async (id: number) => (await payload.count({ collection: 'runs', where: { ticket: { equals: id } }, ...o })).totalDocs
  expect(await runsOf(stuck.id)).toBe(0)
  expect(await runsOf(live.id)).toBe(1)
})

it('restore works before purgeAt, clears both fields and writes workspace:restore; keys are not restored', async () => {
  await expect(del.restoreWorkspace(payload, member, wsB)).rejects.toThrow('Only an Admin')
  await expect(del.restoreWorkspace(payload, admin, wsA)).rejects.toThrow('cannot be restored')
  await expect(del.restoreWorkspace(payload, admin, wsB, new Date('2026-11-27T10:00:01Z'))).rejects.toThrow('cannot be restored')
  expect((await del.archivedWorkspaces(payload)).map((w) => w.id)).toEqual([wsB])
  await del.restoreWorkspace(payload, admin, wsB, new Date('2026-11-20T10:00:00Z'))
  const ws = (await rows(sql`SELECT * FROM "workspaces" WHERE "id" = ${wsB}`))[0]
  expect([ws.archived_at, ws.purge_at, ws.gateway_key, ws.router_key]).toEqual([null, null, null, null])
  const touches = await rows(sql`SELECT * FROM "human_touches" WHERE "kind" = 'workspace:restore'`)
  expect(touches).toHaveLength(1)
  expect(touches[0]).toMatchObject({ workspace_id: wsB, actor: 'a@x.io', detail: { id: wsB, slug: 'beta' } })
  const { workspacesOf } = await import('../src/app/(app)/lib/session')
  expect((await workspacesOf(admin as never)).map((w) => w.id).sort()).toEqual([wsA, wsB].sort())
})
