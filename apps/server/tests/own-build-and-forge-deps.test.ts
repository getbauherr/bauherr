import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let jobs: typeof import('../src/jobs')
let call: (name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
let repo = ''
let connection: number
let n = 0

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('own_build_303')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  const { callTool } = await import('../src/lib/mcp-tools')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  user = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  call = (name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(async () => {
  await payload.delete({ collection: 'runs', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'tickets', where: { workspace: { equals: ws } }, ...o })
  await payload.delete({ collection: 'ticket_sources', where: { workspace: { equals: ws } }, ...o })
  repo = `acme/own-${++n}`
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
/** Bumps updatedAt like a forge does on any edit, so the next poll sees the Ticket as changed. */
const touch = (n: string) => fake.tickets(repo).addLabels(n, [`touch-${++n_}`])
let n_ = 0
const order = async () => (await call('list_frontier', {})).map((t: any) => t.number)

/** An open Ticket in `stage` on the fake forge and locally; `builtBy` adds a succeeded Build Run with that label, `awaiting` an awaiting_session Run of `stage`. */
const ticket = async (title: string, stage: 'build' | 'review', opts: { builtBy?: string; awaiting?: boolean } = { awaiting: true }) => {
  const labels = [`bauherr:stage:${stage}`]
  const issue = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, labels, product, workspace: ws, rank: title }, ...o })
  if (opts.builtBy) await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', sessionLabel: opts.builtBy, workspace: ws }, ...o })
  const run = opts.awaiting ? await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: 'awaiting_session', mode: 'session', workspace: ws }, ...o }) : null
  return { id: t.id as number, number: issue.number, n: String(issue.number), run }
}

describe('own-build skip', () => {
  const setup = async () => ({ review: await ticket('a', 'review', { builtBy: 'builder-a', awaiting: true }), build: await ticket('b', 'build') })

  it('builder A gets the Build Run, reviewer B the Review; the label is stored on the claimed Run', async () => {
    const { review, build } = await setup()
    const a = await call('claim_next', { session: 'builder-a' })
    expect(a.run.id).toBe(build.run!.id)
    expect(a.skipped).toContainEqual({ ticket: review.id, number: review.number, stage: 'review', reason: 'your own build' })
    expect((await payload.findByID({ collection: 'runs', id: build.run!.id, ...o })).sessionLabel).toBe('builder-a')
    const b = await call('claim_next', { session: 'reviewer-b' })
    expect(b.run.id).toBe(review.run!.id)
  })

  it('sessions without a label are never skipped', async () => {
    const { review } = await setup()
    expect((await call('claim_next', {})).run.id).toBe(review.run!.id)
  })

  it('list_frontier marks the own Review as not claimable', async () => {
    const { review } = await setup()
    const row = (await call('list_frontier', { session: 'builder-a' })).find((t: any) => t.ticket === review.id)
    expect(row).toMatchObject({ claimable: false, reason: 'your own build' })
    expect((await call('list_frontier', { session: 'other' })).find((t: any) => t.ticket === review.id).claimable).toBe(true)
  })

  it('claim_run of the own Review is refused and names the next Run the caller may take', async () => {
    const { review, build } = await setup()
    await expect(call('claim_run', { runId: review.run!.id, session: 'builder-a' })).rejects.toThrow(`take Run ${build.run!.id} (#${build.number}, build) first`)
    await expect(call('claim_run', { runId: build.run!.id, session: 'builder-a' })).resolves.toMatchObject({ run: { id: build.run!.id } })
  })

  it('claim_run of the own Review with nothing else claimable is refused as your own build', async () => {
    const { review } = await setup().then(async (s) => (await payload.update({ collection: 'runs', id: s.build.run!.id, data: { status: 'cancelled' }, ...o }), s))
    await expect(call('claim_run', { runId: review.run!.id, session: 'builder-a' })).rejects.toThrow('your own build')
    expect((await call('claim_next', { session: 'builder-a' }))).toBeNull()
  })

  it('rejects a session label over 64 characters', async () => {
    await expect(call('claim_next', { session: 'x'.repeat(65) })).rejects.toThrow('at most 64')
  })
})

describe('forge dependencies', () => {
  it('a forge dependency leaves the Ticket out of the order within one poll and closing the blocker puts it back', async () => {
    const blocker = await ticket('a', 'build', { awaiting: false })
    const dependent = await ticket('b', 'build')
    await poll()
    expect(await order()).toContain(dependent.number)
    await fake.tickets(repo).addBlockedBy(dependent.n, blocker.n)
    await touch(dependent.n)
    await poll()
    expect((await reload(dependent.id)).blockedBy).toEqual([blocker.id])
    expect(await order()).not.toContain(dependent.number)
    await fake.tickets(repo).close(blocker.n, 'completed')
    await poll()
    expect(await order()).toContain(dependent.number)
  })

  it('a dependency the forge drops disappears locally', async () => {
    const blocker = await ticket('a', 'build', { awaiting: false })
    const dependent = await ticket('b', 'build')
    await poll()
    const forge = fake.tickets(repo) as any
    await forge.addBlockedBy(dependent.n, blocker.n)
    await touch(dependent.n)
    await poll()
    expect((await reload(dependent.id)).blockedBy).toEqual([blocker.id])
    forge.setRel(forge.t(dependent.n), { parent: null, blockedBy: [], links: [] })
    await touch(dependent.n)
    await poll()
    expect((await reload(dependent.id)).blockedBy).toEqual([])
    expect(await order()).toContain(dependent.number)
  })

  it('a blocker not polled yet is ignored, then counts once its Ticket is known', async () => {
    const dependent = await ticket('b', 'build')
    await poll()
    await touch(dependent.n)
    const stranger = await fake.tickets(repo).create({ title: 'z', labels: [] })
    await fake.tickets(repo).addBlockedBy(dependent.n, String(stranger.number))
    await poll()
    expect((await reload(dependent.id)).blockedBy ?? []).toEqual([])
    await touch(dependent.n)
    await poll()
    expect((await reload(dependent.id)).blockedBy).toHaveLength(1)
  })

  it('a forge read error keeps the stored set', async () => {
    const blocker = await ticket('a', 'build', { awaiting: false })
    const dependent = await ticket('b', 'build')
    await poll()
    await fake.tickets(repo).addBlockedBy(dependent.n, blocker.n)
    await touch(dependent.n)
    await poll()
    const forge = fake.tickets(repo)
    await touch(dependent.n)
    const real = Object.getPrototypeOf(forge).get
    const stub = (id: string) => (id === dependent.n ? Promise.reject(new Error('forge down')) : real.call(forge, id))
    ;(forge as any).get = stub
    try {
      await poll()
    } finally {
      delete (forge as any).get
    }
    expect((await reload(dependent.id)).blockedBy).toEqual([blocker.id])
  })

  it('a Ticket that names itself as its own blocker is not blocked by itself', async () => {
    const blocker = await ticket('a', 'build', { awaiting: false })
    const dependent = await ticket('b', 'build')
    await poll()
    const forge = fake.tickets(repo)
    const real = Object.getPrototypeOf(forge).get
    ;(forge as any).get = async (id: string) => {
      const t = await real.call(forge, id)
      return id === dependent.n ? { ...t, blockedBy: [dependent.n, blocker.n] } : t
    }
    try {
      await touch(dependent.n)
      await poll()
    } finally {
      delete (forge as any).get
    }
    expect((await reload(dependent.id)).blockedBy).toEqual([blocker.id])
  })
})
