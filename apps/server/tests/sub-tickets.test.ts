import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'

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
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  user = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  workspace = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace }, ...o })
  ticket = (await payload.create({
    collection: 'tickets',
    data: { title: 'Overhaul invoicing', externalId: 'e2e-1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'plan', product, workspace },
    ...o,
  })).id as number
})

afterAll(async () => {
  await payload?.destroy()
})

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
  const p = await ts.create({ title: 'Forge-approved parent', labels: ['bauherr:stage:plan', 'bauherr:approved:plan'] })
  await ts.comment(String(p.number), `<!-- bauherr:plan -->\n${PLAN}`)
  const { pollTickets } = await import('../src/jobs')
  await (pollTickets.handler as any)({ req: { payload } })
  const row = (await payload.find({ collection: 'tickets', where: { number: { equals: p.number } }, depth: 0, ...o })).docs[0]!
  expect(row.stage).toBe('parent')
  expect((await payload.find({ collection: 'tickets', where: { parent: { equals: row.id } }, depth: 0, ...o })).totalDocs).toBe(2)
  expect(await payload.count({ collection: 'runs', where: { ticket: { equals: row.id } }, ...o })).toMatchObject({ totalDocs: 0 })
  await (pollTickets.handler as any)({ req: { payload } })
  expect((await ts.listSubTickets(String(p.number))).map((k) => k.title)).toEqual(['Invoice PDF', 'Invoice numbering'])
})
