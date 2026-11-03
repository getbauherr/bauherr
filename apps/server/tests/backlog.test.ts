import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let member: Record<string, any>
let outsider: Record<string, any>
let product: number
let ws: number
let n = 0
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const
let other: number

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('backlog')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  other = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  outsider = await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

/** An open Ticket with rank `rank` and, unless `run` is null, an awaiting_session Run of the given stage. */
const seed = async (rank: string | null, extra: Record<string, unknown> = {}, run: Record<string, unknown> | null = {}) => {
  const ticket = await payload.create({ collection: 'tickets', data: { title: `t-${rank}`, externalId: `b-${++n}`, number: 1, state: 'open', labels: [], stage: 'build', product, workspace: ws, rank, ...extra }, ...o })
  const r = run && (await payload.create({ collection: 'runs', data: { ticket: ticket.id, stage: 'build', mode: 'session', status: 'awaiting_session', workspace: ws, ...run }, ...o }))
  return { ticket, run: r }
}
const reset = async () => {
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
}
const rankOf = async (id: number | string) => (await payload.findByID({ collection: 'tickets', id, ...o })).rank as string

it('claim_next returns null when nothing is claimable', async () => {
  await reset()
  await seed('b', {}, null)
  await seed('c', {}, { status: 'running' })
  expect(await call(member, 'claim_next', {})).toBeNull()
})

it('claim_next takes the rightmost stage before the top-ranked Ticket, skipping blocked ones', async () => {
  await reset()
  const top = await seed('a')
  const flight = await seed('z', { stage: 'review' })
  const blocker = await seed('zz', {}, null)
  const blocked = await seed('A', { blockedBy: [blocker.ticket.id] })
  expect((await call(member, 'list_frontier', {})).map((t: any) => t.ticket).slice(0, 2)).toEqual([flight.ticket.id, top.ticket.id])
  const first = await call(member, 'claim_next', {})
  expect(first).toMatchObject({ run: { id: flight.run!.id, status: 'running' }, leaseToken: expect.any(String) })
  const second = await call(member, 'claim_next', {})
  expect(second.run.id).toBe(top.run!.id)
  expect(await call(member, 'claim_next', {})).toBeNull()
  expect((await payload.findByID({ collection: 'runs', id: blocked.run!.id, ...o })).status).toBe('awaiting_session')
})

it('two parallel claim_next calls get different Runs', async () => {
  await reset()
  const a = await seed('a')
  const b = await seed('b')
  const [x, y] = await Promise.all([call(member, 'claim_next', {}), call(member, 'claim_next', {})])
  expect([x.run.id, y.run.id].sort()).toEqual([a.run!.id, b.run!.id].sort())
})

it('claim_next honors the Product filter and the caller\'s Workspace', async () => {
  await reset()
  const mine = await seed('a')
  await expect(call(member, 'claim_next', { product: 'nope' })).resolves.toBeNull()
  expect(await call(outsider, 'claim_next', {})).toBeNull()
  expect((await call(member, 'claim_next', { product: 'web' })).run.id).toBe(mine.run!.id)
})

it('rankTicket places a Ticket between its neighbours; non-members and other Workspaces are refused', async () => {
  await reset()
  const [a, b, c] = [await seed('a', {}, null), await seed('b', {}, null), await seed('c', {}, null)]
  await actions.rankTicket(payload, member, { ticket: c.ticket.id, before: a.ticket.id, after: b.ticket.id, workspaceId: ws })
  const r = await rankOf(c.ticket.id)
  expect(r > 'a' && r < 'b').toBe(true)
  await actions.rankTicket(payload, member, { ticket: a.ticket.id, before: b.ticket.id, workspaceId: ws })
  expect(await rankOf(a.ticket.id) > 'b').toBe(true)
  await expect(actions.rankTicket(payload, outsider, { ticket: a.ticket.id, workspaceId: ws })).rejects.toThrow()
  await expect(actions.rankTicket(payload, member, { ticket: a.ticket.id, workspaceId: other })).rejects.toBeInstanceOf(actions.NotInWorkspace)
})

it('new Tickets rank after the last one of their Workspace only', async () => {
  await reset()
  await seed('m', {}, null)
  await seed('Z', {}, null)
  const next = await actions.lastRankAfter(payload, ws)
  expect(next > 'm').toBe(true)
  expect(await actions.lastRankAfter(payload, other)).toBe('V')
})

it('rankTicket drops the lower bound when the displayed neighbours are out of rank order', async () => {
  await reset()
  const [flight, first, moved] = [await seed('c', {}, null), await seed('b', {}, null), await seed('d', {}, null)]
  await seed('a', {}, null)
  await actions.rankTicket(payload, member, { ticket: moved.ticket.id, before: flight.ticket.id, after: first.ticket.id, workspaceId: ws })
  const r = await rankOf(moved.ticket.id)
  expect(r > 'a' && r < 'b').toBe(true)
})

it('claim_next moves on when the snapshot\'s top Run was claimed meanwhile', async () => {
  await reset()
  const top = await seed('a')
  const next = await seed('b')
  const find = payload.find.bind(payload)
  const spy = vi.spyOn(payload, 'find').mockImplementation((async (args: any) => {
    const r = await find(args)
    if (args.collection === 'runs') {
      spy.mockRestore()
      await payload.update({ collection: 'runs', id: top.run!.id, data: { status: 'running', sessionOwner: outsider.id }, ...o })
    }
    return r
  }) as any)
  expect((await call(member, 'claim_next', {})).run.id).toBe(next.run!.id)
})

it('frontier ranks before any limit: the top-ranked Ticket beyond the first 100 by id is still claimed', async () => {
  await reset()
  for (let i = 0; i < 100; i++) await seed('m', {}, null)
  const top = await seed('a')
  expect((await call(member, 'claim_next', {})).run.id).toBe(top.run!.id)
})

it('rankTicket opens a gap when the neighbours leave no room, keeping the order', async () => {
  await reset()
  const [a, b, c] = [await seed('00001', {}, null), await seed('000010', {}, null), await seed('000011', {}, null)]
  const moved = await seed('x', {}, null)
  await actions.rankTicket(payload, member, { ticket: moved.ticket.id, before: a.ticket.id, after: b.ticket.id, workspaceId: ws })
  const [ra, rm, rb, rc] = [await rankOf(a.ticket.id), await rankOf(moved.ticket.id), await rankOf(b.ticket.id), await rankOf(c.ticket.id)]
  expect(ra < rm && rm < rb && rb < rc).toBe(true)
})

it('claim_run refuses a Run that claim_next would not return and names the right one', async () => {
  await reset()
  const low = await seed('b')
  const review = await seed('z', { stage: 'review' }, { stage: 'review' })
  await expect(call(member, 'claim_run', { runId: low.run!.id })).rejects.toThrow(`take Run ${review.run!.id} (#1, review) first`)
  expect((await call(member, 'claim_run', { runId: review.run!.id })).run.id).toBe(review.run!.id)
  expect((await call(member, 'claim_run', { runId: low.run!.id })).run.id).toBe(low.run!.id)
})

it('claim_next goes one column left when the right column is leased by another agent', async () => {
  await reset()
  await seed('a', { stage: 'review' }, { stage: 'review', status: 'running', sessionOwner: outsider.id })
  const build = await seed('b')
  const claimed = await call(member, 'claim_next', {})
  expect(claimed.run.id).toBe(build.run!.id)
  expect(claimed.skipped).toEqual([expect.objectContaining({ stage: 'review', reason: `leased by ${outsider.email}` })])
  const row = (await call(member, 'list_frontier', {})).find((t: any) => t.stage === 'review')
  expect(row).toMatchObject({ claimable: false, reason: `leased by ${outsider.email}` })
})

it('claim_next skips a parent and reports a blocked Ticket ahead', async () => {
  await reset()
  await seed('a', { stage: 'parent' }, { stage: 'plan' })
  const blocker = await seed('zz', {}, null)
  await seed('b', { stage: 'review', blockedBy: [blocker.ticket.id] }, null)
  const build = await seed('c')
  const claimed = await call(member, 'claim_next', {})
  expect(claimed.run.id).toBe(build.run!.id)
  expect(claimed.skipped).toEqual([expect.objectContaining({ stage: 'review', reason: expect.stringMatching(/^blocked by #/) })])
})

it('claim_run rejects the Run of a parent', async () => {
  await reset()
  const parent = await seed('a', { stage: 'parent' }, { stage: 'plan' })
  await expect(call(member, 'claim_run', { runId: parent.run!.id })).rejects.toThrow('parents are not claimable')
})

it('claim_run accepts a Run whose Ticket is assigned to the caller, and refuses one assigned to someone else', async () => {
  await reset()
  const sess = await payload.create({ collection: 'bauherren', data: { email: 's@x.io', password: 'pw-123456', role: 'bauherr', githubLogin: 'fake', tenants: [{ tenant: ws }] }, ...o })
  const top = await seed('a', { assignees: 'someone' })
  const mine = await seed('b', { assignees: 'x,fake' })
  const other = await seed('c', { assignees: 'someone' })
  expect((await call(sess, 'claim_run', { runId: mine.run!.id })).run.id).toBe(mine.run!.id)
  await expect(call(sess, 'claim_run', { runId: other.run!.id })).rejects.toThrow(`take Run ${top.run!.id} (#1, build) first`)
})

it('ranks zzzzxV and zzzzxk are in the same order on the Board and in claim_next', async () => {
  await reset()
  const upper = await seed('zzzzxV')
  const lower = await seed('zzzzxk')
  const { frontierOrder } = await import('../src/lib/frontier')
  const board = frontierOrder([upper.ticket, lower.ticket] as any, new Map()).map((t) => t.id)
  expect(board).toEqual([upper.ticket.id, lower.ticket.id])
  expect((await call(member, 'claim_next', {})).run.id).toBe(upper.run!.id)
})

it('JS cmp order equals ORDER BY "rank" COLLATE "C" for mixed-case ranks', async () => {
  await reset()
  const ids = [(await seed('zzzzxV', {}, null)).ticket.id, (await seed('zzzzxk', {}, null)).ticket.id, (await seed('zzzzxA', {}, null)).ticket.id, (await seed('zzzzx0', {}, null)).ticket.id]
  const { cmp } = await import('../src/lib/frontier')
  const ranks = await Promise.all(ids.map(rankOf))
  const js = ids.map((id, i) => ({ id, rank: ranks[i] })).sort((x, y) => cmp(x.rank, y.rank)).map((x) => x.id)
  const db = await payload.db.drizzle.execute(sql`SELECT "id" FROM "tickets" WHERE "workspace_id" = ${ws} ORDER BY "rank" COLLATE "C"`)
  expect(db.rows.map((r: any) => r.id)).toEqual(js)
})
