import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

let payload: Payload
let fake: FakeBackend
let ws: number
let product: number
let gates: typeof import('../src/lib/gates')
let jobs: typeof import('../src/jobs')
let call: (user: Record<string, any>, name: string, input: unknown) => Promise<any>
const o = { overrideAccess: true } as const
const repo = 'acme/web'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_gates WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_gates')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_gates')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  gates = await import('../src/lib/gates')
  jobs = await import('../src/jobs')
  const { callTool } = await import('../src/lib/mcp-tools')
  call = (user, name, input) => callTool({ payload, user, actor: { kind: 'human' } }, name, input)
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'fake' }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
})

/** A plan Ticket whose plan Run succeeded: the Approve plan gate. */
const planTicket = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:plan'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, url: issue.url, state: 'open', stage: 'plan', labels: ['bauherr:stage:plan'], product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  return { id: t.id as number, n: String(issue.number) }
}
const reload = async (id: number) => (await payload.findByID({ collection: 'tickets', id, depth: 0, ...o })) as Record<string, any>
const gateComments = async (n: string) => (await fake.tickets(repo).listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:gate:'))
const issue = (n: string) => (fake.tickets(repo) as any).t(n) as { assignees: string[] }

it('assigns and mentions the Admin once per gate, and clears both when the gate is passed', async () => {
  const { id, n } = await planTicket('gate')
  await gates.syncGates(payload)
  await gates.syncGates(payload)
  const [c, ...rest] = await gateComments(n)
  expect(rest).toHaveLength(0)
  expect(c.body).toMatch(/^<!-- bauherr:gate:Approve plan:[0-9a-f]{40} -->\n@fake: Approve plan — .*\/tickets\/\d+$/)
  expect(issue(n).assignees).toEqual(['fake'])
  expect(await reload(id)).toMatchObject({ gateNotified: 'Approve plan', gateAssignees: 'fake' })

  await payload.update({ collection: 'tickets', id, data: { labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] }, ...o })
  await gates.syncGates(payload)
  expect(issue(n).assignees).toEqual([])
  expect(await reload(id)).toMatchObject({ gateNotified: null, gateNotifiedAt: null, gateAssignees: null })
})

it('keeps a human co-assignee when the gate is passed', async () => {
  const { id, n } = await planTicket('co-assigned')
  await gates.syncGates(payload)
  await fake.tickets(repo).claim(n, 'e2e-admin')
  await payload.update({ collection: 'tickets', id, data: { assignees: 'fake,e2e-admin', labels: ['bauherr:approved:plan'] }, ...o })
  await gates.syncGates(payload)
  expect(issue(n).assignees).toEqual(['e2e-admin'])
  expect(await reload(id)).toMatchObject({ gateNotified: null, gateAssignees: null })
})

it('retries a claim that fails with a 5xx on the next sweep, without a second Comment', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'e2e-admin, late' }, ...o })
  fake.opts.users!.push('late')
  const proto = Object.getPrototypeOf(fake.tickets(repo)) as any
  const orig = proto.claim
  const spy = vi.spyOn(proto, 'claim').mockImplementation(async function (this: unknown, tid: any, login: any) {
    if (login === 'late') throw Object.assign(new Error('boom'), { status: 503 })
    return orig.call(this, tid, login)
  })
  const { id, n } = await planTicket('retry')
  await gates.syncGates(payload)
  expect(issue(n).assignees).toEqual(['e2e-admin'])
  expect(await reload(id)).toMatchObject({ gateNotified: null, gateAssignees: 'e2e-admin' })
  expect(await gateComments(n)).toHaveLength(1)
  spy.mockRestore()
  await gates.syncGates(payload)
  expect(issue(n).assignees).toEqual(['e2e-admin', 'late'])
  expect(await reload(id)).toMatchObject({ gateNotified: 'Approve plan', gateAssignees: 'e2e-admin,late' })
  expect(await gateComments(n)).toHaveLength(1)
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

it('starts a Run only when every assignee is a factory gate assignee', async () => {
  const poll = (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)
  const runsOf = async (n: number) => (await payload.find({ collection: 'runs', where: { 'ticket.number': { equals: n } }, ...o })).totalDocs
  const human = await fake.tickets(repo).create({ title: 'human', labels: ['bauherr:stage:plan'] })
  await fake.tickets(repo).claim(String(human.number), 'e2e-admin')
  const own = await fake.tickets(repo).create({ title: 'own', labels: ['bauherr:stage:plan'] })
  await fake.tickets(repo).claim(String(own.number), 'fake')
  await payload.create({ collection: 'tickets', data: { title: 'own', externalId: String(own.number), number: own.number, state: 'open', stage: 'triage', gateAssignees: 'fake', product, workspace: ws }, ...o })
  await poll({ req: { payload } })
  expect(await runsOf(human.number)).toBe(0)
  expect(await runsOf(own.number)).toBe(1)
})

it('drops a login the forge rejects for good and still completes the gate', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'ghost, e2e-admin' }, ...o })
  const { id, n } = await planTicket('owners')
  await gates.syncGates(payload)
  expect(issue(n).assignees).toEqual(['e2e-admin'])
  const body = (await gateComments(n))[0].body
  expect(body).toContain('@e2e-admin: Approve plan')
  expect(body).not.toContain('@ghost')
  expect((await reload(id)).gateNotified).toBe('Approve plan')
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

it('rejects only new, unknown gate owner logins', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'ghost' }, ...o })
  expect(await gates.unknownLogins(payload, product, 'ghost, e2e-admin')).toEqual([])
  expect(await gates.unknownLogins(payload, product, 'ghost, nobody, fake')).toEqual(['nobody'])
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

/** A Ticket on staging (Accept on staging) with a finished build Run. */
const stagingTicket = async (title: string) => {
  const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:release'] })
  const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, state: 'open', stage: 'release', releaseState: 'on_staging', labels: ['bauherr:stage:release'], product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'build', status: 'succeeded', mode: 'autonomous', workspace: ws }, ...o })
  return { id: t.id as number, n: String(issue.number) }
}

it('keeps an owner of both gates assigned when the gate changes, with one new Comment', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'e2e-admin' }, ...o })
  const { id, n } = await stagingTicket('staging')
  await gates.syncGates(payload)
  expect(await reload(id)).toMatchObject({ gateNotified: 'Accept on staging', gateAssignees: 'e2e-admin' })
  await payload.update({ collection: 'tickets', id, data: { assignees: 'e2e-admin', releaseState: 'timed_out' }, ...o })
  await gates.syncGates(payload)
  expect(issue(n).assignees).toEqual(['e2e-admin'])
  expect(await reload(id)).toMatchObject({ gateNotified: 'Staging not confirmed', gateAssignees: 'e2e-admin' })
  expect(await gateComments(n)).toHaveLength(2)
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

it('a session release unassigns only its own login, not the gate owner', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'e2e-admin' }, ...o })
  const { id, n } = await stagingTicket('session')
  await gates.syncGates(payload)
  const member = await payload.create({ collection: 'bauherren', data: { email: 'm@x.io', password: 'pw-123456', role: 'bauherr', githubLogin: 'fake', tenants: [{ tenant: ws }] }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  expect(issue(n).assignees).toEqual(['e2e-admin', 'fake'])
  await call(member, 'release_run', { runId: run.id, leaseToken })
  expect(issue(n).assignees).toEqual(['e2e-admin'])
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

it('starts the missing Run when recording a gate assignee, but never for a hand-worked Ticket', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'e2e-admin' }, ...o })
  const mk = async (title: string, assignees: string) => {
    const issue = await fake.tickets(repo).create({ title, labels: ['bauherr:stage:build'] })
    const t = await payload.create({ collection: 'tickets', data: { title, externalId: String(issue.number), number: issue.number, state: 'open', stage: 'build', labels: ['bauherr:stage:build'], assignees, product, workspace: ws }, ...o })
    await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'plan', status: 'failed', mode: 'autonomous', workspace: ws }, ...o })
    return t.id as number
  }
  const runs = async (id: number) => (await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: id } }, { stage: { equals: 'build' } }] }, ...o })).totalDocs
  const free = await mk('race', '')
  const worked = await mk('hand-worked', 'someone')
  await gates.syncGates(payload)
  expect(await runs(free)).toBe(1)
  expect(await runs(worked)).toBe(0)
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

it('a session release keeps its login assigned when that login owns the gate', async () => {
  await payload.update({ collection: 'products', id: product, data: { gateOwners: 'fake' }, ...o })
  const { id, n } = await stagingTicket('same login')
  await gates.syncGates(payload)
  await fake.tickets(repo).unassign(n, ['fake'])
  const member = await payload.create({ collection: 'bauherren', data: { email: 'm2@x.io', password: 'pw-123456', role: 'bauherr', githubLogin: 'fake', tenants: [{ tenant: ws }] }, ...o })
  const run = await payload.create({ collection: 'runs', data: { ticket: id, stage: 'build', status: 'awaiting_session', mode: 'session', workspace: ws }, ...o })
  const { leaseToken } = await call(member, 'claim_run', { runId: run.id })
  await call(member, 'release_run', { runId: run.id, leaseToken })
  expect(issue(n).assignees).toEqual(['fake'])
  await payload.update({ collection: 'products', id: product, data: { gateOwners: '' }, ...o })
})

it('notifies the Round cap reached gate like the others', async () => {
  const issue2 = await fake.tickets(repo).create({ title: 'cap', labels: ['bauherr:stage:review'] })
  const t = await payload.create({ collection: 'tickets', data: { title: 'cap', externalId: String(issue2.number), number: issue2.number, url: issue2.url, state: 'open', stage: 'review', reviewState: 'needs_human', reviewRounds: 3, product, workspace: ws }, ...o })
  await payload.create({ collection: 'runs', data: { ticket: t.id, stage: 'review', status: 'succeeded', mode: 'session', workspace: ws }, ...o })
  await gates.syncGates(payload)
  await gates.syncGates(payload)
  const comments = await gateComments(String(issue2.number))
  expect(comments).toHaveLength(1)
  expect(comments[0]!.body).toMatch(/^<!-- bauherr:gate:Round cap reached:[0-9a-f]{40} -->\n@fake: Round cap reached/)
  expect(await reload(t.id as number)).toMatchObject({ gateNotified: 'Round cap reached', gateAssignees: 'fake' })
})
