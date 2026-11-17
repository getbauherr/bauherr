import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let user: Record<string, any>
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
let gates: typeof import('../src/lib/gates')
let finishAgentRun: typeof import('../src/lib/agent-stage').finishAgentRun
const o = { overrideAccess: true } as const
const repo = 'acme/plan-jobs'
const PLAN = '## Goal\n- Ship it\n\n## Steps\n1. Do it'

let testDb: TestDb
beforeAll(async () => {
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/plan-jobs-pack', import.meta.url))
  testDb = await createTestDb('plan_jobs')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  gates = await import('../src/lib/gates')
  ;({ finishAgentRun } = await import('../src/lib/agent-stage'))
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'autonomous', wipLimits: {} }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  delete process.env.BAUHERR_PACK_DIR
  await payload?.destroy()
  await testDb?.drop(payload)
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const get = async (collection: 'runs' | 'tickets', id: number) => (await payload.findByID({ collection, id, depth: 0, ...o })) as Record<string, any>
const planRuns = async (ticket: number) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket } }, { stage: { equals: 'plan' } }] }, sort: 'id', depth: 0, pagination: false, ...o })).docs as Record<string, any>[]

const planTicket = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:plan'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  await actions.submitPlan(payload, user, { ticket: t.id as number, markdown: PLAN })
  return { id: t.id as number, n: String(issue.number) }
}

it('Approve plan waits for the agent-experience scan, which starts after the plan Run and posts its comment', async () => {
  const { id, n } = await planTicket('scan first')
  await gates.syncGates(payload)
  expect((await get('tickets', id)).needsYou ?? null).toBeNull()
  await expect(actions.approvePlan(payload, user, { ticket: id })).rejects.toThrow('still running')

  await poll()
  const scan = (await planRuns(id)).filter((r) => r.job === 'ax-scan')
  expect(scan).toHaveLength(1)
  expect(scan[0]).toMatchObject({ kind: 'agent', role: 'ax', status: 'queued' })
  await poll()
  expect(await planRuns(id)).toHaveLength(2)

  await gates.syncGates(payload)
  expect((await get('tickets', id)).needsYou ?? null).toBeNull()

  await payload.update({ collection: 'runs', id: scan[0]!.id, data: { status: 'succeeded' }, ...o })
  await finishAgentRun(payload, await get('runs', scan[0]!.id), await get('tickets', id), 'findings', 'Agent experience: 2 moves')
  expect((await fake.tickets(repo).listComments(n)).some((c) => c.body.startsWith('<!-- bauherr:stage:plan/ax-scan -->') && c.body.includes('2 moves'))).toBe(true)
  expect((await get('tickets', id)).stage).toBe('plan')

  await gates.syncGates(payload)
  expect((await get('tickets', id)).needsYou).toBe('Approve plan')
  await actions.approvePlan(payload, user, { ticket: id })
  await poll()
  expect((await get('tickets', id)).stage).toBe('build')
})

it('a failed scan Run is not approved over: the owner is asked about the Run', async () => {
  const { id } = await planTicket('scan fails')
  await poll()
  const scan = (await planRuns(id)).find((r) => r.job === 'ax-scan')!
  await payload.update({ collection: 'runs', id: scan.id, data: { status: 'needs_human', reasonKind: 'decision' }, ...o })
  await gates.syncGates(payload)
  expect((await get('tickets', id)).needsYou).toBe('Run needs you')
})
