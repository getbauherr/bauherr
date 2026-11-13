import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { claimOnly } from './helpers/claim'
import { createTestDb, type TestDb } from './helpers/test-db'

vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))

let payload: Payload
let fake: FakeBackend
let ws: number
let otherWs: number
let productA: number
let productB: number
let admin: Record<string, any>
let member: Record<string, any>
let outsider: Record<string, any>
let po: Record<string, any>
let poOther: Record<string, any>
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
const o = { overrideAccess: true } as const
const repo = 'acme/web'
let testDb: TestDb

beforeAll(async () => {
  testDb = await createTestDb('send_back')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.BAUHERR_PACK_DIR
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  otherWs = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  const product = (name: string, slug: string) => payload.create({ collection: 'products', data: { name, slug, workspace: ws } as never, ...o }).then((p) => p.id as number)
  productA = await product('web', 'web')
  productB = await product('api', 'api')
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product: productA, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/api', product: productB, connection, workspace: ws }, ...o })
  const user = (email: string, data: Record<string, unknown>) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', ...data } as never, ...o }).then((u) => payload.findByID({ collection: 'bauherren', id: u.id, depth: 0, ...o }) as Promise<Record<string, any>>)
  admin = await user('admin@x.io', { role: 'admin' })
  member = await user('m@x.io', { role: 'bauherr', tenants: [{ tenant: ws }] })
  outsider = await user('out@x.io', { role: 'bauherr', tenants: [{ tenant: otherWs }] })
  po = await user('po@x.io', { role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [productA] }] })
  poOther = await user('po2@x.io', { role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [productB] }] })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const runsOf = async (id: number) => (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: 'id', depth: 0, pagination: false, showHiddenFields: true, ...o })).docs as Record<string, any>[]
const eventsOf = async (id: number) => (await payload.find({ collection: 'ticket_events', where: { ticket: { equals: id } }, sort: 'at', pagination: false, depth: 0, ...o })).docs as Record<string, any>[]
const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const factoryStage = async (id: number) => (await payload.db.drizzle.execute(sql`SELECT "factory_stage" AS s FROM "tickets" WHERE "id" = ${id}`)).rows[0]!.s

/** A Ticket in `stage` (null = untriaged) on the fake forge with its stage label; `build` and `plan` get a claimed session Run, as in a live session. */
const ticketIn = async (stage: string | null, opts: { product?: number; extraLabels?: string[]; state?: 'open' | 'closed'; claim?: boolean } = {}) => {
  const productId = opts.product ?? productA
  const r = productId === productA ? repo : 'acme/api'
  const issue = await fake.tickets(r).create({ title: `t-${Math.random()}`, labels: [...(stage ? [`bauherr:stage:${stage}`] : []), ...(opts.extraLabels ?? [])] })
  const t = await payload.create({ collection: 'tickets', data: { title: issue.title, externalId: String(issue.number), number: issue.number, url: issue.url, state: opts.state ?? 'open', stage: stage ?? undefined, labels: [...(stage ? [`bauherr:stage:${stage}`] : []), ...(opts.extraLabels ?? [])], product: productId, workspace: ws }, ...o })
  let lease: { runId: number; leaseToken: string } | undefined
  if (stage && opts.claim !== false && ['plan', 'build'].includes(stage)) {
    const run = await payload.create({ collection: 'runs', data: { ticket: t.id, stage, status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
    const { leaseToken } = await claimOnly(payload, call, member, ws, run.id)
    lease = { runId: run.id as number, leaseToken }
  }
  return { id: t.id as number, n: String(issue.number), repo: r, lease }
}
const labelsOf = async (t: { n: string; repo: string }) => (await fake.tickets(t.repo).get(t.n)).labels
const commentsOf = async (t: { n: string; repo: string }) => (await fake.tickets(t.repo).listComments(t.n)).map((c) => c.body)

describe('sendBackTargets', () => {
  it('equals the workflow backward outcomes plus backlog, per stage', async () => {
    const { DEFAULT } = await import('../src/lib/workflow')
    const wf = DEFAULT()
    expect(actions.sendBackTargets(wf, 'build')).toEqual(['plan', 'backlog'])
    expect(actions.sendBackTargets(wf, 'plan')).toEqual(['triage', 'backlog'])
    expect(actions.sendBackTargets(wf, 'review')).toEqual(['build', 'triage', 'backlog'])
    expect(actions.sendBackTargets(wf, 'release')).toEqual(['build', 'backlog'])
  })

  it('is empty for stages that are not live or at staging', async () => {
    const { DEFAULT } = await import('../src/lib/workflow')
    for (const s of ['triage', 'parent', 'done', 'nope']) expect(actions.sendBackTargets(DEFAULT(), s)).toEqual([])
  })

  it('follows a custom workflow file', async () => {
    const { compile } = await import('../src/lib/workflow')
    const { parseFactory } = await import('../src/lib/workflow-rules')
    const wf = compile(parseFactory(readFileSync(fileURLToPath(new URL('./fixtures/custom-pack/factory.yaml', import.meta.url)), 'utf8')))
    expect(actions.sendBackTargets(wf, 'security')).toEqual(['build', 'backlog'])
    expect(actions.sendBackTargets(wf, 'build')).toEqual(['plan', 'backlog'])
    expect(actions.sendBackTargets(wf, 'signoff')).toEqual([])
  })
})

describe('sendBack', () => {
  it('moves Build to Plan: Run ends cleanly, label and factoryStage set, no revert on poll, Plan Run, note, one transition', async () => {
    const t = await ticketIn('build', { extraLabels: ['bauherr:approved:plan'] })
    const before = await runsOf(t.id)
    const r = await actions.sendBack(payload, member, { ticket: t.id, to: 'plan', note: 'not now, waiting for cloud credentials' })
    expect(r).toMatchObject({ stage: 'plan' })

    const runs = await runsOf(t.id)
    expect(runs.map((x) => [x.stage, x.status])).toEqual([['build', 'cancelled'], ['plan', 'awaiting_session']])
    expect(runs[0]).toMatchObject({ id: before[0]!.id, leaseHash: null, sessionOwner: null })
    expect(runs[0]!.finishedAt).toBeTruthy()
    expect(await reload(t.id)).toMatchObject({ stage: 'plan' })
    expect(await factoryStage(t.id)).toBe('plan')
    expect(await labelsOf(t)).toContain('bauherr:stage:plan')
    expect(await labelsOf(t)).not.toContain('bauherr:stage:build')
    expect(await labelsOf(t)).not.toContain('bauherr:approved:plan')
    expect((await commentsOf(t)).some((c) => c.includes('Sent back to Plan by m@x.io: not now, waiting for cloud credentials'))).toBe(true)
    expect((await eventsOf(t.id)).filter((e) => e.cause === 'sendBack')).toMatchObject([{ stage: 'plan', executor: 'human', actor: expect.stringContaining('m@x.io') }])

    await poll()
    expect(await reload(t.id)).toMatchObject({ stage: 'plan' })
    expect(await labelsOf(t)).toContain('bauherr:stage:plan')
    expect((await runsOf(t.id)).map((x) => [x.stage, x.status])).toEqual([['build', 'cancelled'], ['plan', 'awaiting_session']])
  })

  it('a held session stops without "Run failed", escalation or a successor, and its lease is gone', async () => {
    const t = await ticketIn('build')
    await actions.sendBack(payload, member, { ticket: t.id, to: 'plan' })
    const runs = await runsOf(t.id)
    expect(runs.filter((x) => ['failed', 'needs_human', 'abandoned'].includes(x.status))).toEqual([])
    expect(runs.filter((x) => x.stage === 'build')).toHaveLength(1)
    expect(runs[0]!.error ?? '').not.toMatch(/lease|escalat/)
    await expect(call(member, 'heartbeat', t.lease!)).rejects.toThrow('lease lost')
    expect((await commentsOf(t)).filter((c) => /needs a human|escalat|retry/i.test(c))).toEqual([])
    const { needsOf } = await import('../src/app/(app)/lib/needs-you')
    const wf = (await import('../src/lib/factory')).workflowFor(ws)
    expect(needsOf(wf, (await reload(t.id)) as never, runs.at(-1) as never, false)).toBeNull()
  })

  it('rejects a target outside the stage backward outcomes and writes nothing', async () => {
    const t = await ticketIn('build')
    for (const to of ['review', 'triage', 'build', 'release', 'nope', '']) {
      await expect(actions.sendBack(payload, member, { ticket: t.id, to })).rejects.toThrow(/cannot be sent back to/)
    }
    expect(await reload(t.id)).toMatchObject({ stage: 'build' })
    expect((await runsOf(t.id)).map((x) => [x.stage, x.status])).toEqual([['build', 'running']])
    expect(await commentsOf(t)).toEqual([])
  })

  it('sends a Ticket back to the backlog: no stage, no label, no new Run', async () => {
    const t = await ticketIn('build')
    await expect(actions.sendBack(payload, member, { ticket: t.id, to: 'backlog', note: 'park it' })).resolves.toMatchObject({ stage: null })
    expect(await reload(t.id)).toMatchObject({ stage: null })
    expect((await labelsOf(t)).filter((l) => l.startsWith('bauherr:stage:'))).toEqual([])
    expect((await runsOf(t.id)).map((x) => [x.stage, x.status])).toEqual([['build', 'cancelled']])
    expect((await commentsOf(t)).some((c) => c.includes('park it'))).toBe(true)
    await poll()
    expect(await reload(t.id)).toMatchObject({ stage: null })
  })

  it('sends Review back to Build and starts a Build Run', async () => {
    const t = await ticketIn('review')
    await expect(actions.sendBack(payload, member, { ticket: t.id, to: 'build', note: 'rethink' })).resolves.toMatchObject({ stage: 'build' })
    expect(await reload(t.id)).toMatchObject({ stage: 'build' })
    expect((await runsOf(t.id)).map((x) => [x.stage, x.status])).toEqual([['build', 'awaiting_session']])
  })

  it('ignores WIP limits', async () => {
    await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: { plan: 1 } } as never, ...o })
    const a = await ticketIn('plan')
    const t = await ticketIn('build')
    await actions.sendBack(payload, member, { ticket: t.id, to: 'plan' })
    expect(await reload(t.id)).toMatchObject({ stage: 'plan', waitingFor: null })
    expect((await runsOf(t.id)).map((x) => [x.stage, x.status])).toEqual([['build', 'cancelled'], ['plan', 'awaiting_session']])
    expect(await reload(a.id)).toMatchObject({ stage: 'plan' })
    await payload.update({ collection: 'workspaces', id: ws, data: { wipLimits: {} } as never, ...o })
  })

  it('a double submit moves once: one Run, one comment, one transition', async () => {
    const t = await ticketIn('build')
    const results = await Promise.allSettled([1, 2].map(() => actions.sendBack(payload, member, { ticket: t.id, to: 'plan', note: 'once' })))
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await runsOf(t.id)).map((x) => [x.stage, x.status])).toEqual([['build', 'cancelled'], ['plan', 'awaiting_session']])
    expect((await commentsOf(t)).filter((c) => c.includes('once'))).toHaveLength(1)
    expect((await eventsOf(t.id)).filter((e) => e.cause === 'sendBack')).toHaveLength(1)
    await expect(actions.sendBack(payload, member, { ticket: t.id, to: 'plan', note: 'once' })).rejects.toThrow()
  })

  describe('permissions', () => {
    it('Admin and Bauherr may send back', async () => {
      for (const who of [admin, member]) {
        const t = await ticketIn('build')
        await expect(actions.sendBack(payload, who, { ticket: t.id, to: 'plan' })).resolves.toMatchObject({ stage: 'plan' })
      }
    })

    it('a Bauherr of another Workspace and a mismatching selected Workspace are refused, nothing written', async () => {
      const t = await ticketIn('build')
      await expect(actions.sendBack(payload, outsider, { ticket: t.id, to: 'plan' })).rejects.toThrow()
      await expect(actions.sendBack(payload, member, { ticket: t.id, to: 'plan', workspaceId: otherWs })).rejects.toBeInstanceOf(actions.NotInWorkspace)
      expect((await runsOf(t.id)).map((x) => x.status)).toEqual(['running'])
    })

    it('a Product owner may send back only at staging, on their Product', async () => {
      const build = await ticketIn('build')
      await expect(actions.sendBack(payload, po, { ticket: build.id, to: 'plan' })).rejects.toThrow()
      expect(await reload(build.id)).toMatchObject({ stage: 'build' })
      const staging = await ticketIn('release')
      await expect(actions.sendBack(payload, poOther, { ticket: staging.id, to: 'build', note: 'no' })).rejects.toBeInstanceOf(actions.NotInWorkspace)
      expect(await reload(staging.id)).toMatchObject({ stage: 'release' })
      await expect(actions.sendBack(payload, po, { ticket: staging.id, to: 'backlog' })).rejects.toBeInstanceOf(actions.NotAddressed)
      expect(await reload(staging.id)).toMatchObject({ stage: 'release' })
      await expect(actions.sendBack(payload, po, { ticket: staging.id, to: 'build', note: 'the toggle is not reachable' })).resolves.toMatchObject({ stage: 'build' })
      expect(await reload(staging.id)).toMatchObject({ stage: 'build' })
    })

    it('a closed Ticket and a Ticket outside the live stages are refused', async () => {
      const closed = await ticketIn('build', { state: 'closed', claim: false })
      await expect(actions.sendBack(payload, member, { ticket: closed.id, to: 'plan' })).rejects.toThrow(/closed/)
      const untriaged = await ticketIn(null)
      await expect(actions.sendBack(payload, member, { ticket: untriaged.id, to: 'backlog' })).rejects.toThrow(/not in a stage/)
      const triaged = await ticketIn('triage')
      await expect(actions.sendBack(payload, member, { ticket: triaged.id, to: 'backlog' })).rejects.toThrow(/not in a stage/)
      for (const t of [closed, triaged]) expect(await reload(t.id)).toMatchObject({ stage: t === closed ? 'build' : 'triage' })
    })
  })
})
