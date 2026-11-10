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
  testDb = await createTestDb('claim_stages_416')
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
  repo = `acme/stages-${++n}`
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
/** Bumps updatedAt like a forge does on any edit, so the next poll sees the Ticket as changed. */
const touch = (n: string) => fake.tickets(repo).addLabels(n, [`touch-${++n_}`])
let n_ = 0
const order = async () => (await call('list_frontier', {})).map((t: any) => t.number)

/** An open Ticket in `stage` on the fake forge and locally; `builtBy` adds a succeeded Build Run with that label, `awaiting` an awaiting_session Run of `stage`. */
const ticket = async (title: string, stage: 'build' | 'review', opts: { builtBy?: string; awaiting?: boolean; expedite?: boolean } = { awaiting: true }) => {
  const labels = [`bauherr:stage:${stage}`]
  const issue = await fake.tickets(repo).create({ title, labels })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage, labels, product, workspace: ws, rank: title, expedite: !!opts.expedite }, ...o })
  if (opts.builtBy) await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'session', sessionLabel: opts.builtBy, workspace: ws }, ...o })
  const run = opts.awaiting ? await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: 'awaiting_session', mode: 'session', workspace: ws }, ...o }) : null
  return { id: t.id as number, number: issue.number, n: String(issue.number), run }
}

describe('stages argument (#416)', () => {
  const setup = async () => ({ review: await ticket('a', 'review'), build: await ticket('b', 'build') })

  it('claim_next {stages: [build]} returns the top Build while an unclaimed Review sits above it', async () => {
    const { review, build } = await setup()
    const r = await call('claim_next', { stages: ['build'] })
    expect(r.run.id).toBe(build.run!.id)
    expect(r.skipped.map((s: any) => s.ticket)).not.toContain(review.id)
  })

  it('claim_run on that Build is accepted with stages: [build] and refused without', async () => {
    const { review, build } = await setup()
    await expect(call('claim_run', { runId: build.run!.id })).rejects.toThrow(`take Run ${review.run!.id}`)
    expect((await call('claim_run', { runId: build.run!.id, stages: ['build'] })).run.id).toBe(build.run!.id)
  })

  it('claim_run refuses a Run outside its stages', async () => {
    const { review } = await setup()
    await expect(call('claim_run', { runId: review.run!.id, stages: ['build'] })).rejects.toThrow('not in stages build')
  })

  it('list_frontier {stages: [review]} lists only Review Tickets; empty stages means all', async () => {
    const { review, build } = await setup()
    expect((await call('list_frontier', { stages: ['review'] })).map((t: any) => t.ticket)).toEqual([review.id])
    expect((await call('list_frontier', { stages: [] })).map((t: any) => t.ticket)).toEqual([review.id, build.id])
  })

  it('the own-build skip still applies within stages', async () => {
    const review = await ticket('a', 'review', { builtBy: 'x', awaiting: true })
    const r = await call('claim_next', { stages: ['review'], session: 'x' })
    expect(r).toBeNull()
    expect((await call('claim_next', { stages: ['review'], session: 'y' })).run.id).toBe(review.run!.id)
  })

  it('an expedite Ticket in Build is claimed before a normal Build', async () => {
    await ticket('a', 'build')
    const expedite = await ticket('b', 'build', { awaiting: true, expedite: true })
    expect((await call('claim_next', { stages: ['build'] })).run.id).toBe(expedite.run!.id)
  })

  it('an expedite Ticket in Review is not returned for stages build', async () => {
    await ticket('a', 'review', { awaiting: true, expedite: true })
    const build = await ticket('b', 'build')
    expect((await call('claim_next', { stages: ['build'] })).run.id).toBe(build.run!.id)
  })

  it('an unknown stage is an error', async () => {
    await expect(call('claim_next', { stages: ['deploy'] })).rejects.toThrow('unknown stage deploy')
  })
})
