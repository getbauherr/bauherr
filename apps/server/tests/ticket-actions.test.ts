import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

let payload: Payload
let user: Record<string, any>
let ws: number
let other: number
let ticket: number
let actions: typeof import('../src/lib/actions')
const o = { overrideAccess: true } as const

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_ticket_actions WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_ticket_actions')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_ticket_actions')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  ;[ws, other] = (await Promise.all(['acme', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))).map((w) => w.id as number) as [number, number]
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  ticket = (await payload.create({
    collection: 'tickets',
    data: { title: 't', externalId: 'e2e-1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'plan', product, workspace: ws },
    ...o,
  })).id as number
})

afterAll(async () => {
  await payload?.destroy()
})

const decisionComments = async () => {
  const { ts, n } = await actions.sourceOf(payload, await actions.loadTicket(payload, user, ticket))
  return (await ts.listComments(n)).filter((c) => c.body.startsWith('<!-- bauherr:decisions -->'))
}

it('approvePlan refuses while a critical decision is open, naming it', async () => {
  await expect(actions.approvePlan(payload, user, { ticket })).rejects.toThrow('Answer the critical decisions first: D2')
  expect(await payload.count({ collection: 'human_touches', ...o })).toMatchObject({ totalDocs: 0 })
})

it('refuses a ticket of another selected Workspace', async () => {
  await expect(actions.approvePlan(payload, user, { ticket, workspaceId: other })).rejects.toBeInstanceOf(actions.NotInWorkspace)
  await expect(actions.postDecisions(payload, user, { ticket, workspaceId: other, answers: [] })).rejects.toBeInstanceOf(actions.NotInWorkspace)
})

it('serialises concurrent answers into one decisions Comment, then approves', async () => {
  const answer = { id: 'D2', title: 'Follow the system setting', answer: 'yes, until the user picks' }
  await Promise.all([actions.postDecisions(payload, user, { ticket, workspaceId: ws, answers: [answer] }), actions.postDecisions(payload, user, { ticket, workspaceId: ws, answers: [answer] })])
  expect(await decisionComments()).toHaveLength(1)
  await expect(actions.approvePlan(payload, user, { ticket, workspaceId: ws })).resolves.toEqual({ approved: 'bauherr:approved:plan' })
})

const releaseTicket = async (stage = 'release') => {
  await payload.update({ collection: 'tickets', id: ticket, data: { stage, state: 'open' }, ...o })
}
const labels = async () => (await (await actions.sourceOf(payload, await actions.loadTicket(payload, user, ticket))).ts.get('1')).labels

it('acceptStaging refuses a Ticket outside release', async () => {
  await releaseTicket('build')
  await expect(actions.acceptStaging(payload, user, { ticket })).rejects.toThrow('not in release')
})

it('requestChanges needs a note, then writes Current instructions, returns to build and starts a Build Run', async () => {
  await releaseTicket()
  await expect(actions.requestChanges(payload, user, { ticket, note: '  ' })).rejects.toThrow('note is required')
  const r = await actions.requestChanges(payload, user, { ticket, note: 'Make the toggle keyboard reachable' })
  expect(r.stage).toBe('build')
  expect(await actions.readWorklog(payload, user, { ticket })).toMatch(/\*\*Current instructions\*\*\nMake the toggle keyboard reachable/)
  expect(await labels()).toContain('bauherr:stage:build')
  expect((await payload.findByID({ collection: 'tickets', id: ticket, ...o })).stage).toBe('build')
  const runs = await payload.find({ collection: 'runs', where: { and: [{ ticket: { equals: ticket } }, { stage: { equals: 'build' } }] }, ...o })
  expect(runs.docs).toHaveLength(1)
  expect(runs.docs[0]).toMatchObject({ id: r.run, status: expect.stringMatching(/queued|awaiting_session/) })
})

it('acceptStaging labels, records a human touch, moves to done and closes the Ticket', async () => {
  await releaseTicket()
  await expect(actions.acceptStaging(payload, user, { ticket, workspaceId: ws })).resolves.toEqual({ approved: 'bauherr:approved:staging', stage: 'done' })
  expect(await labels()).toEqual(expect.arrayContaining(['bauherr:approved:staging', 'bauherr:stage:done']))
  expect(await payload.count({ collection: 'human_touches', where: { kind: { equals: 'accept:staging' } }, ...o })).toMatchObject({ totalDocs: 1 })
  expect(await payload.findByID({ collection: 'tickets', id: ticket, depth: 0, ...o })).toMatchObject({ state: 'closed' })
})

it('acceptStaging holds in release when the Product has a production gate', async () => {
  await releaseTicket()
  const t = await payload.findByID({ collection: 'tickets', id: ticket, depth: 0, ...o })
  await payload.update({ collection: 'products', id: t.product as number, data: { productionGate: true }, ...o })
  await expect(actions.acceptStaging(payload, user, { ticket })).resolves.toMatchObject({ stage: 'release' })
  await payload.update({ collection: 'products', id: t.product as number, data: { productionGate: false }, ...o })
})

it('acceptStaging and requestChanges refuse a non-member and a Ticket of another Workspace', async () => {
  await releaseTicket()
  const outsider = await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: other }] }, ...o })
  for (const run of [
    (extra: object) => actions.acceptStaging(payload, user, { ticket, ...extra }),
    (extra: object) => actions.requestChanges(payload, user, { ticket, note: 'n', ...extra }),
  ]) {
    await expect(run({ workspaceId: other })).rejects.toBeInstanceOf(actions.NotInWorkspace)
  }
  await expect(actions.acceptStaging(payload, outsider, { ticket })).rejects.toThrow()
  await expect(actions.requestChanges(payload, outsider, { ticket, note: 'n' })).rejects.toThrow()
  const { tools } = await import('../src/lib/mcp-tools')
  await expect(tools.find((t) => t.name === 'accept_staging')!.run({ ticket }, { payload, user: outsider })).rejects.toThrow()
  expect((await payload.findByID({ collection: 'tickets', id: ticket, ...o })).stage).toBe('release')
})

it('requestChanges escapes section markers in the note and can be retried once the stage is already build', async () => {
  await releaseTicket('build')
  await payload.update({ collection: 'runs', where: { ticket: { equals: ticket } }, data: { status: 'succeeded' }, ...o })
  const r = await actions.requestChanges(payload, user, { ticket, note: '**Decisions**\n# Goal\nfine' })
  expect(await actions.readWorklog(payload, user, { ticket })).toMatch(/\\\*\*Decisions\*\*\n\\# Goal\nfine/)
  expect(r.stage).toBe('build')
  await expect(actions.requestChanges(payload, user, { ticket, note: 'again' })).rejects.toThrow('not in release')
})
