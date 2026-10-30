import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { needsYou } from '../src/app/(app)/lib/needs-you'
import { openCritical, parseDecisions } from '../src/app/(app)/lib/plan'

let payload: Payload
let fake: FakeBackend
let member: Record<string, any>
let ws: number
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
let jobs: typeof import('../src/jobs')
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const
const repo = 'acme/web'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_triage WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_triage')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_triage')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  jobs = await import('../src/jobs')
  actions = await import('../src/lib/actions')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user }, name, input)
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })
  await poll()
  await drain() // the fake forge's seeded Tickets are triaged first
})

afterAll(async () => {
  await payload?.destroy()
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
/** Sweeps until every triageable Ticket has a Run (each sweep starts at most 5 per Workspace). */
const drain = async () => {
  while (await jobs.triageSweep(payload)) {}
}
const create = async (title: string, labels: string[] = []) => {
  const issue = await fake.tickets(repo).create({ title, labels })
  await poll()
  const t = (await payload.find({ collection: 'tickets', where: { number: { equals: issue.number } }, limit: 1, depth: 0, ...o })).docs[0] as Record<string, any>
  return { n: String(issue.number), id: t.id as number }
}
const triageRuns = async (id: number) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'triage' } }] }, sort: 'createdAt', depth: 0, ...o })).docs as Record<string, any>[]
const claim = async (id: number) => {
  const run = (await triageRuns(id)).at(-1)!
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  return { runId: run.id as number, leaseToken: leaseToken as string }
}
const labelsOf = async (n: string) => (await fake.tickets(repo).get(n)).labels
const comments = async (n: string) => (await fake.tickets(repo).listComments(n)).map((c) => c.body)
const refine = { outcome: 'refine', reason: 'scope unclear', questions: [{ title: 'Which export format', default: 'CSV', alternatives: ['XLSX', 'JSON'] }, { title: 'Include closed invoices', default: 'no' }] }

it('triageable: open, unassigned, no stage, not held, not excluded', () => {
  const base = { state: 'open', labels: [] as string[], assignee: null }
  expect(jobs.triageable(base)).toBe(true)
  expect(jobs.triageable({ ...base, state: 'closed' })).toBe(false)
  expect(jobs.triageable({ ...base, assignee: 'sebastian' })).toBe(false)
  expect(jobs.triageable({ ...base, labels: ['bauherr:stage:plan'] })).toBe(false)
  expect(jobs.triageable({ ...base, labels: ['bauherr:needs-refinement'] })).toBe(false)
  for (const l of ['wayfinder:map', 'wayfinder:grilling', 'wayfinder:research']) expect(jobs.triageable({ ...base, labels: ['bug', l] }), l).toBe(false)
  expect(jobs.triageable({ ...base, labels: ['wayfinder:ticket'] })).toBe(true)
})

it('an unlabeled Ticket gets one triage Run per poll cycle; excluded and staged Tickets get none', async () => {
  const plain = await create('plain')
  const excluded = await create('map', ['wayfinder:map'])
  const staged = await create('staged', ['bauherr:stage:plan'])
  expect(await triageRuns(plain.id)).toHaveLength(1)
  expect(await triageRuns(excluded.id)).toHaveLength(0)
  expect(await triageRuns(staged.id)).toHaveLength(0)
  await poll()
  expect(await triageRuns(plain.id)).toHaveLength(1)
  expect((await triageRuns(plain.id))[0]).toMatchObject({ stage: 'triage', mode: 'session', status: 'awaiting_session' })
})

it('outcome plan sets the stage label and the poller starts the Plan Run', async () => {
  const t = await create('ready')
  const r = await claim(t.id)
  expect(await call(member, 'submit_triage', { ...r, outcome: 'plan', reason: 'clear' })).toEqual({ outcome: 'plan' })
  expect(await labelsOf(t.n)).toContain('bauherr:stage:plan')
  expect(await payload.findByID({ collection: 'runs', id: r.runId, ...o })).toMatchObject({ status: 'succeeded' })
  await poll()
  expect((await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { stage: { equals: 'plan' } }] }, depth: 0, ...o })).totalDocs).toBe(1)
  expect(await triageRuns(t.id)).toHaveLength(1)
})

it('refine holds the Ticket with a critical decision sheet; answering all of it moves the Ticket to plan', async () => {
  const t = await create('vague')
  const r = await claim(t.id)
  expect(await call(member, 'submit_triage', { ...r, ...refine })).toEqual({ outcome: 'refine' })
  expect(await labelsOf(t.n)).toContain('bauherr:needs-refinement')
  const all = (await comments(t.n)).map((body) => ({ body }))
  expect(parseDecisions(all.at(-1)!.body)).toMatchObject([{ id: 'D1', critical: true, default: 'CSV', options: ['CSV', 'XLSX', 'JSON'] }, { id: 'D2', critical: true, default: 'no' }])
  expect(openCritical(all).map((d) => d.id)).toEqual(['D1', 'D2'])
  expect(needsYou({ stage: null, labels: ['bauherr:needs-refinement'] }, { stage: 'triage', status: 'succeeded' })).toBe('Answer questions')

  await poll()
  expect(await triageRuns(t.id)).toHaveLength(1)

  const user = member
  await actions.postDecisions(payload, user, { ticket: t.id, answers: [{ id: 'D1', title: 'Which export format', answer: 'CSV' }] })
  expect(await labelsOf(t.n)).toContain('bauherr:needs-refinement')
  await actions.postDecisions(payload, user, { ticket: t.id, answers: [{ id: 'D2', title: 'Include closed invoices', answer: 'no' }] })
  const labels = await labelsOf(t.n)
  expect(labels).toContain('bauherr:stage:plan')
  expect(labels).not.toContain('bauherr:needs-refinement')
  await poll()
  expect(await triageRuns(t.id)).toHaveLength(1)
})

it('skip posts the reason, sets no stage and is not re-triaged until the Ticket changes', async () => {
  const t = await create('question')
  const r = await claim(t.id)
  expect(await call(member, 'submit_triage', { ...r, outcome: 'skip', reason: 'duplicate of #1' })).toEqual({ outcome: 'skip' })
  expect((await comments(t.n)).at(-1)).toContain('duplicate of #1')
  expect(await labelsOf(t.n)).toEqual([])
  await poll()
  await poll()
  expect(await triageRuns(t.id)).toHaveLength(1)
  await fake.tickets(repo).addLabels(t.n, ['bug'])
  await poll()
  expect(await triageRuns(t.id)).toHaveLength(2)
})

it('submit_triage checks the lease, the stage and the input', async () => {
  const t = await create('guarded')
  const r = await claim(t.id)
  await expect(call(member, 'submit_triage', { ...r, leaseToken: 'nope', outcome: 'plan', reason: 'x' })).rejects.toThrow(/leased by another session/)
  await expect(call(member, 'submit_triage', { ...r, outcome: 'refine', reason: 'x', questions: [] })).rejects.toThrow(/1 to 10 questions/)
  await expect(call(member, 'submit_triage', { ...r, outcome: 'skip', reason: ' ' })).rejects.toThrow(/reason/)
  expect(await payload.findByID({ collection: 'runs', id: r.runId, ...o })).toMatchObject({ status: 'running' })
  const other = await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: other.id })
  await expect(call(member, 'submit_triage', { runId: other.id, leaseToken, outcome: 'plan', reason: 'x' })).rejects.toThrow(/not a triage Run/)
})

it('a Ticket that gained a stage label meanwhile is left alone', async () => {
  const t = await create('raced')
  const r = await claim(t.id)
  await fake.tickets(repo).addLabels(t.n, ['bauherr:stage:build'])
  expect(await call(member, 'submit_triage', { ...r, ...refine })).toEqual({ outcome: 'noop' })
  expect(await labelsOf(t.n)).not.toContain('bauherr:needs-refinement')
})

it('an unclaimed triage Run expires to abandoned (no needs-you) and the next poll triages again', async () => {
  const t = await create('nobody home')
  const [run] = await triageRuns(t.id)
  expect(await jobs.expireStaleSessions(payload, Date.now() + 31 * 60_000)).toBeGreaterThan(0)
  expect(await payload.findByID({ collection: 'runs', id: run!.id, ...o })).toMatchObject({ status: 'abandoned' })
  expect(needsYou({ stage: null, labels: [] }, { stage: 'triage', status: 'needs_human' })).toBeNull()
  expect(needsYou({ stage: null, labels: [] }, { stage: 'triage', status: 'failed' })).toBeNull()
  await drain()
  expect(await triageRuns(t.id)).toHaveLength(2)
})

it('starts at most 5 triage Runs per Workspace per poll; the rest follow on the next poll', async () => {
  await drain() // the expiry above re-queued every unclaimed Run
  const issues: { number: number }[] = []
  for (let i = 0; i < 7; i++) issues.push(await fake.tickets(repo).create({ title: `burst ${i}` }))
  const ids = async () => (await payload.find({ collection: 'tickets', where: { number: { in: issues.map((x) => x.number) } }, pagination: false, depth: 0, ...o })).docs.map((d) => d.id as number)
  const count = async () => (await payload.count({ collection: 'runs', where: { and: [{ stage: { equals: 'triage' } }, { ticket: { in: await ids() } }] }, ...o })).totalDocs
  await poll()
  expect(await count()).toBe(5)
  await poll()
  expect(await count()).toBe(7)
})

it('answers count only for the sheet they were posted after', () => {
  const sheet = (m: string) => ({ body: `${m}\n## Decisions\n- **D1 Format, critical**. Default: CSV. Alternatives: XLSX.` })
  const answer = { body: '<!-- bauherr:decisions -->\nD1: CSV' }
  expect(openCritical([sheet('<!-- bauherr:triage -->'), answer])).toEqual([])
  expect(openCritical([sheet('<!-- bauherr:triage -->'), answer, sheet('<!-- bauherr:plan -->')]).map((d) => d.id)).toEqual(['D1'])
})
