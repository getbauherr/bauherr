import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

let payload: Payload
let user: Record<string, any>
let ticket: number
let product: number
let workspace: number
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const

const PLAN = `## Goal
- Overhaul invoicing

## Sub-tickets
- **Invoice PDF** — Render invoices as PDF.
- **Invoice numbering** — Sequential numbers.
`

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_sub_tickets WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_sub_tickets')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_sub_tickets')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  workspace = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace, gateOwners: 'owner' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace }, ...o })
  ticket = (await payload.create({
    collection: 'tickets',
    data: { title: 'Overhaul invoicing', externalId: 'e2e-1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'plan', product, workspace, rank: 'm' },
    ...o,
  })).id as number
  await payload.create({ collection: 'tickets', data: { title: 'Next in line', externalId: 'e2e-90', number: 90, url: 'https://x/90', state: 'open', labels: [], stage: 'plan', product, workspace, rank: 'n' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

/** Creates a Ticket whose labels were set by a gate owner (the factory's own label would need a recorded approval). */
const createAsOwner = async (ts: Awaited<ReturnType<typeof forge>>, t: Parameters<typeof ts.create>[0]) => {
  const fake = (await import('../src/lib/fake-forge')).fakeForge()
  fake.actingAs = 'owner'
  try {
    return await ts.create(t)
  } finally {
    fake.actingAs = 'factory'
  }
}

const forge = async () => (await actions.sourceOf(payload, await actions.loadTicket(payload, user, ticket))).ts
const children = async () => (await forge()).listSubTickets('1')

it('a plan without Sub-tickets approves as before: no children, stage stays plan', async () => {
  await actions.submitPlan(payload, user, { ticket, markdown: '## Goal\n- x' })
  await actions.approvePlan(payload, user, { ticket })
  expect(await children()).toHaveLength(0)
  expect((await (await forge()).get('1')).labels).toContain('bauherr:stage:plan')
  expect((await payload.findByID({ collection: 'tickets', id: ticket, ...o })).stage).toBe('plan')
})

it('approval creates the listed children with inherited approval and moves the parent to stage parent', async () => {
  await actions.submitPlan(payload, user, { ticket, markdown: PLAN })
  await actions.approvePlan(payload, user, { ticket })
  const kids = await children()
  expect(kids.map((k) => k.title)).toEqual(['Invoice PDF', 'Invoice numbering'])
  for (const k of kids) expect(k.labels.sort()).toEqual(['bauherr:approved:plan', 'bauherr:stage:plan'])
  expect((await (await forge()).get('1')).labels).toContain('bauherr:stage:parent')
  expect((await (await forge()).get('1')).labels).not.toContain('bauherr:stage:plan')
  expect((await (await forge()).get(String(kids[0]!.number))).body).toContain('Render invoices as PDF.\n\nParent: #1')
  const rows = (await payload.find({ collection: 'tickets', where: { parent: { equals: ticket } }, sort: 'number', depth: 0, ...o })).docs
  expect(rows.map((r) => [r.title, r.inheritedApprovalFrom, r.stage])).toEqual([['Invoice PDF', ticket, 'plan'], ['Invoice numbering', ticket, 'plan']])
  expect((await payload.findByID({ collection: 'tickets', id: ticket, ...o })).stage).toBe('parent')
  expect((await (await forge()).listComments(String(kids[0]!.number))).at(-1)!.body).toContain('Approval inherited from #1')
})

it('children rank directly after the parent in section order and keep their rank on retry', async () => {
  const rank = async () => (await payload.find({ collection: 'tickets', where: { parent: { equals: ticket } }, sort: 'number', depth: 0, ...o })).docs.map((r) => r.rank as string)
  const [a, b] = await rank()
  expect(a! > 'm' && a! < b! && b! < 'n').toBe(true)
  await actions.spawnSubTickets(payload, await actions.loadTicket(payload, user, ticket))
  expect(await rank()).toEqual([a, b])
})

it('is idempotent and never inherits for an item added after approval', async () => {
  await actions.submitPlan(payload, user, { ticket, markdown: `${PLAN}- **Late addition** — Added after approval.\n` })
  await actions.approvePlan(payload, user, { ticket })
  expect(await actions.spawnSubTickets(payload, await actions.loadTicket(payload, user, ticket))).toBe(true)
  expect((await children()).map((k) => k.title)).toEqual(['Invoice PDF', 'Invoice numbering'])
})

it('completes a partially created set by title without duplicating', async () => {
  const ts = await forge()
  const t = await actions.loadTicket(payload, user, ticket)
  await ts.removeLabels('1', ['bauherr:stage:parent'])
  await ts.addLabels('1', ['bauherr:stage:plan'])
  await actions.submitPlan(payload, user, { ticket, markdown: PLAN })
  await actions.spawnSubTickets(payload, t)
  expect(await children()).toHaveLength(2)
})

it('closes the parent with a Comment only when all children are closed', async () => {
  const ts = await forge()
  const [a, b] = await children()
  await ts.close(String(a!.number), 'completed')
  expect(await actions.closeFinishedParents(payload)).toBe(0)
  expect((await ts.get('1')).state).toBe('open')
  await ts.close(String(b!.number), 'completed')
  expect(await actions.closeFinishedParents(payload)).toBe(1)
  expect((await ts.get('1')).state).toBe('closed')
  expect((await ts.listComments('1')).at(-1)!.body).toMatch(/All sub-tickets are closed:\n- #\d+ Invoice PDF\n- #\d+ Invoice numbering/)
  expect(await payload.findByID({ collection: 'tickets', id: ticket, ...o })).toMatchObject({ state: 'closed', stage: 'done' })
  expect(await actions.closeFinishedParents(payload)).toBe(0)
})

it('poll-tickets: a forge-side plan approval on an unseen Ticket fans out and parks it as parent', async () => {
  const ts = await forge()
  const p = await createAsOwner(ts, { title: 'Forge-approved parent', labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  await ts.comment(String(p.number), `<!-- bauherr:plan -->\n${PLAN}`)
  const { pollTickets } = await import('../src/jobs')
  await (pollTickets.handler as any)({ req: { payload } })
  const row = (await payload.find({ collection: 'tickets', where: { number: { equals: p.number } }, depth: 0, ...o })).docs[0]!
  expect(row.stage).toBe('parent')
  const kids = (await payload.find({ collection: 'tickets', where: { parent: { equals: row.id } }, sort: 'number', depth: 0, ...o })).docs
  expect(kids).toHaveLength(2)
  expect(row.rank).toEqual(expect.any(String))
  expect([row.rank, ...kids.map((k) => k.rank)].map(String)).toEqual([...new Set([row.rank, ...kids.map((k) => k.rank)].map(String))].sort())
  expect(await payload.count({ collection: 'runs', where: { ticket: { equals: row.id } }, ...o })).toMatchObject({ totalDocs: 0 })
  await (pollTickets.handler as any)({ req: { payload } })
  expect((await ts.listSubTickets(String(p.number))).map((k) => k.title)).toEqual(['Invoice PDF', 'Invoice numbering'])
})

it('a manually approved child is not recorded as inherited', async () => {
  const ts = await forge()
  const c = await createAsOwner(ts, { title: 'Manually approved', body: 'Parent: #1', labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  const { pollTickets } = await import('../src/jobs')
  await (pollTickets.handler as any)({ req: { payload } })
  const row = (await payload.find({ collection: 'tickets', where: { number: { equals: c.number } }, depth: 0, ...o })).docs[0]!
  expect(row.inheritedApprovalFrom ?? null).toBeNull()
  expect(row.parent ?? null).toBeNull()
  expect(row.stage).toBe('build')
})

const approved = async (title: string, rank?: string) => {
  const ts = await forge()
  const f = await ts.create({ title, labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  await ts.comment(String(f.number), `<!-- bauherr:plan -->\n${PLAN}`)
  const row = await payload.create({ collection: 'tickets', data: { title, externalId: f.id, number: f.number, url: f.url, state: 'open', labels: f.labels, stage: 'plan', product, workspace, ...(rank && { rank }) }, ...o })
  return { ts, f, row }
}

it('fan-out falls back to a rank after the last Ticket when no key fits between neighbours', async () => {
  const { row } = await approved('No room parent', 'k')
  await payload.create({ collection: 'tickets', data: { title: 'Tight', externalId: 'tight', number: 900, url: 'https://x/900', state: 'open', labels: [], stage: 'plan', product, workspace, rank: 'k0' }, ...o })
  expect(await actions.spawnSubTickets(payload, row)).toBe(true)
  const kids = (await payload.find({ collection: 'tickets', where: { parent: { equals: row.id } }, depth: 0, ...o })).docs
  expect(kids).toHaveLength(2)
  for (const k of kids) expect(k.rank).toEqual(expect.any(String))
  const ranks = kids.sort((a, b) => (a.number as number) - (b.number as number)).map((k) => k.rank as string)
  expect(ranks[0]! < ranks[1]! && ranks[0]! > 'k0').toBe(true)
})

it('a parent whose forge close fails stays selectable and is closed on the next pass', async () => {
  const { ts, f, row } = await approved('Close retry parent', 'p')
  await actions.spawnSubTickets(payload, row)
  for (const k of await ts.listSubTickets(String(f.number))) await ts.close(String(k.number), 'completed')
  const spy = vi.spyOn(ts, 'close').mockRejectedValueOnce(new Error('forge down'))
  expect(await actions.closeFinishedParents(payload)).toBe(0)
  expect(await payload.findByID({ collection: 'tickets', id: row.id, ...o })).toMatchObject({ stage: 'parent', state: 'open' })
  expect((await ts.get(String(f.number))).labels).not.toContain('bauherr:stage:done')
  spy.mockRestore()
  expect(await actions.closeFinishedParents(payload)).toBe(1)
  expect((await ts.get(String(f.number))).state).toBe('closed')
})

it('a legacy parent without a rank gets one and its children rank after it', async () => {
  const { row } = await approved('Legacy parent')
  await actions.spawnSubTickets(payload, row)
  const parent = await payload.findByID({ collection: 'tickets', id: row.id, ...o })
  const kids = (await payload.find({ collection: 'tickets', where: { parent: { equals: row.id } }, sort: 'number', depth: 0, ...o })).docs
  const ranks = [parent.rank, ...kids.map((k) => k.rank)] as string[]
  expect(ranks.every((r) => typeof r === 'string')).toBe(true)
  expect(ranks.every((r, i) => i === 0 || ranks[i - 1]! < r)).toBe(true)
})

it('a parent whose forge close succeeded but setStage failed is finished on the next pass without a second close', async () => {
  const { ts, f, row } = await approved('Done retry parent', 'q')
  await actions.spawnSubTickets(payload, row)
  for (const k of await ts.listSubTickets(String(f.number))) await ts.close(String(k.number), 'completed')
  const close = vi.spyOn(ts, 'close')
  const stage = vi.spyOn(ts, 'removeLabels').mockRejectedValueOnce(new Error('forge down'))
  expect(await actions.closeFinishedParents(payload)).toBe(0)
  expect(close).toHaveBeenCalledTimes(1)
  expect((await ts.get(String(f.number))).state).toBe('closed')
  expect(await payload.findByID({ collection: 'tickets', id: row.id, ...o })).toMatchObject({ stage: 'parent' })
  stage.mockRestore()
  expect(await actions.closeFinishedParents(payload)).toBe(1)
  expect(close).toHaveBeenCalledTimes(1)
  expect(await payload.findByID({ collection: 'tickets', id: row.id, ...o })).toMatchObject({ stage: 'done', state: 'closed' })
  close.mockRestore()
})

it('the child record is stored before addSubTicket, so a crash there keeps it and a retry completes the set', async () => {
  const { ts, f, row } = await approved('Crash parent', 'r')
  const spy = vi.spyOn(ts, 'addSubTicket').mockRejectedValueOnce(new Error('forge down'))
  await expect(actions.spawnSubTickets(payload, row)).rejects.toThrow('forge down')
  spy.mockRestore()
  const orphan = (await payload.find({ collection: 'tickets', where: { parent: { equals: row.id } }, depth: 0, ...o })).docs
  expect(orphan).toHaveLength(1)
  expect(orphan[0]!.inheritedApprovalFrom).toBe(row.id)
  await expect(actions.spawnSubTickets(payload, row)).resolves.toBe(true)
  expect((await ts.listSubTickets(String(f.number))).map((k) => k.title)).toEqual(['Invoice PDF', 'Invoice numbering'])
  expect(await payload.findByID({ collection: 'tickets', id: orphan[0]!.id, depth: 0, ...o })).toMatchObject({ parent: row.id, inheritedApprovalFrom: row.id })
})

it('one row per forge issue: a duplicate create is rejected and a racing poll keeps the spawned inheritance', async () => {
  const ts = await forge()
  const f = await ts.create({ title: 'Raced child', labels: ['bauherr:stage:plan'] })
  const create = { workspace, product, externalId: f.id, number: f.number, url: f.url, title: f.title, state: 'open', labels: f.labels, stage: 'plan', parent: ticket, inheritedApprovalFrom: ticket }
  const { pollTickets } = await import('../src/jobs')
  await Promise.all([actions.upsertTicket(payload, create, { parent: ticket, inheritedApprovalFrom: ticket }), (pollTickets.handler as any)({ req: { payload } })])
  const rows = (await payload.find({ collection: 'tickets', where: { externalId: { equals: f.id } }, depth: 0, ...o })).docs
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ parent: ticket, inheritedApprovalFrom: ticket })
  await expect(payload.create({ collection: 'tickets', data: create, ...o })).rejects.toThrow()
})

it('the migration merges existing duplicates into the lowest id, repoints references, then enforces uniqueness', async () => {
  const { sql } = await import('@payloadcms/db-postgres')
  const db = (payload.db as any).drizzle
  for (const r of (await db.execute(sql`SELECT indexname FROM pg_indexes WHERE tablename = 'tickets' AND indexdef LIKE 'CREATE UNIQUE%external_id%'`)).rows) await db.execute(sql.raw(`DROP INDEX "${r.indexname}"`))
  const ins = async (ext: string, parent?: number) =>
    (await db.execute(sql`INSERT INTO "tickets" ("title","product_id","workspace_id","external_id","parent_id","updated_at","created_at") VALUES ('d', ${product}, ${workspace}, ${ext}, ${parent ?? null}, now(), now()) RETURNING id`)).rows[0].id as number
  const keep = await ins('dupe-1')
  const dupe = await ins('dupe-1')
  const child = await ins('dupe-child', dupe)
  const { up } = await import('../src/migrations/20261102_150138_ticket_external_unique')
  await up({ db, payload } as any)
  const ids = (await db.execute(sql`SELECT id FROM "tickets" WHERE "external_id" = 'dupe-1'`)).rows.map((r: any) => r.id)
  expect(ids).toEqual([keep])
  expect((await db.execute(sql`SELECT parent_id FROM "tickets" WHERE id = ${child}`)).rows[0].parent_id).toBe(keep)
  await expect(ins('dupe-1')).rejects.toThrow()
})

it('a child created but not linked is linked on retry, never created twice', async () => {
  const { ts, f, row } = await approved('Orphan parent', 's')
  vi.spyOn(ts, 'addSubTicket').mockRejectedValueOnce(new Error('forge down'))
  await expect(actions.spawnSubTickets(payload, row)).rejects.toThrow('forge down')
  vi.restoreAllMocks()
  await expect(actions.spawnSubTickets(payload, row)).resolves.toBe(true)
  const kids = await ts.listSubTickets(String(f.number))
  expect(kids.map((k) => k.title)).toEqual(['Invoice PDF', 'Invoice numbering'])
  const all = await Promise.all((await ts.list({})).filter((i) => ['Invoice PDF', 'Invoice numbering'].includes(i.title)).map((i) => ts.get(i.id)))
  expect(all.filter((i) => i.body.includes(`Parent: #${f.number}`))).toHaveLength(kids.length)
})

const AFTER_PLAN = `## Sub-tickets
- **Second step** — Needs the first.
  after: First step
- **First step** — Goes first.
- **Orphan after** — Names nothing.
  after: No such sibling
`

it('after: blocks the child on its sibling in the forge and locally; unknown titles are ignored with a warning; the frontier skips it', async () => {
  const ts = await forge()
  const f = await ts.create({ title: 'After parent', labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  await ts.comment(String(f.number), `<!-- bauherr:plan -->\n${AFTER_PLAN}`)
  const row = await payload.create({ collection: 'tickets', data: { title: 'After parent', externalId: f.id, number: f.number, url: f.url, state: 'open', labels: f.labels, stage: 'plan', product, workspace, rank: 't' }, ...o })
  const warn = vi.spyOn(payload.logger, 'warn')
  await actions.spawnSubTickets(payload, row)
  const kids = await ts.listSubTickets(String(f.number))
  const [second, first, loose] = ['Second step', 'First step', 'Orphan after'].map((t) => kids.find((k) => k.title === t)!)
  expect((await ts.get(second.id)).blockedBy).toEqual([first.id])
  expect((await ts.get(first.id)).blockedBy).toEqual([])
  expect((await ts.get(loose.id)).blockedBy).toEqual([])
  expect(warn).toHaveBeenCalledWith(expect.objectContaining({ after: 'No such sibling' }), expect.stringContaining('after:'))
  const local = async (n: number): Promise<Record<string, any>> => (await payload.find({ collection: 'tickets', where: { number: { equals: n } }, depth: 0, ...o })).docs[0]!
  expect((await local(second.number)).blockedBy).toEqual([(await local(first.number)).id])
  expect((await local(loose.number)).blockedBy ?? []).toEqual([])
  const { callTool } = await import('../src/lib/mcp-tools')
  const listed = async () => ((await callTool({ payload, user, actor: { kind: 'human' } }, 'list_frontier', { product: 'web' })) as any[]).map((t: any) => t.ticket)
  expect(await listed()).not.toContain((await local(second.number)).id)
  expect(await listed()).toContain((await local(first.number)).id)
  await payload.update({ collection: 'tickets', id: (await local(first.number)).id, data: { state: 'closed' }, ...o })
  expect(await listed()).toContain((await local(second.number)).id)
  await actions.spawnSubTickets(payload, row)
  expect((await ts.get(second.id)).blockedBy).toEqual([first.id])
  warn.mockRestore()
})
