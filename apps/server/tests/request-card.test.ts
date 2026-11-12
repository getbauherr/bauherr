import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
type User = Doc & { id: number }
let payload: Payload
let testDb: TestDb
let fake: FakeBackend
let request: typeof import('../src/lib/request-conversation')
let actions: typeof import('../src/lib/actions')
let jobs: typeof import('../src/jobs')
let gates: typeof import('../src/lib/gates')
let order: typeof import('../src/lib/request-order')
let ws: number
let web: number
let root: User
let alice: User
const repo = 'acme/web'
const o = { overrideAccess: true, depth: 0 } as const
const who = (user: User) => ({ payload, user, workspace: ws })

beforeAll(async () => {
  testDb = await createTestDb('request_card')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.CHAT_FAKE = '1'
  process.env.MEDIA_DIR = `/tmp/bauherr-request-card-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  request = await import('../src/lib/request-conversation')
  actions = await import('../src/lib/actions')
  jobs = await import('../src/jobs')
  gates = await import('../src/lib/gates')
  order = await import('../src/lib/request-order')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  root = (await payload.create({ collection: 'bauherren', data: { email: 'root@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'maria', tenants: [{ tenant: ws }] }, ...o })) as User
  alice = (await payload.create({ collection: 'bauherren', data: { email: 'alice@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })) as User
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  web = (await payload.create({ collection: 'products', data: { name: 'Web', slug: 'web', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product: web, connection, workspace: ws }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const poll = () => (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
const start = async (user: User) => ({ session: (await payload.create({ collection: 'intake_sessions', data: { product: web, workspace: ws, persona: 'product-user', status: 'open', messages: [], user: user.id }, ...o })).id as number })
const run = (s: { session: number }, user: User, text: string) => request.requestTurn(who(user), { session: s.session, text })
const edit = async (user: User, session: number, patch: Parameters<typeof request.requestEdit>[2] extends infer C ? (C extends { patch: infer P } ? P : never) : never) => (await request.requestEdit(who(user), session, { patch })).card
const cardOf = async (user: User, session: number) => (await request.loadRequestView(who(user), session))!.card
const complete = (session: number, extra: Doc = {}) =>
  payload.update({ collection: 'intake_sessions', id: session, data: { draft: { title: 'Totals wrong', problem: 'The invoice total is wrong', context: 'Invoices page', acceptance_criteria: ['Totals match'], type: 'bug', links: [], ...extra }, messages: [{ role: 'user', content: 'x' }] }, ...o })

it('a hand edit of the card is stored, kept by the next interview turn and the model sees it', async () => {
  const s = await start(alice)
  const card = await edit(alice, s.session, { title: 'My title', type: 'change', acceptance_criteria: ['  One  ', '', 'Two'] })
  expect(card).toMatchObject({ title: 'My title', kind: 'change', criteria: ['One', 'Two'], editable: true })
  expect(await payload.findByID({ collection: 'intake_sessions', id: s.session, ...o })).toMatchObject({ title: 'My title', kind: 'change', edited: ['title', 'type', 'acceptance_criteria'] })
  await run(s, alice, 'The invoice total is wrong')
  const after = (await payload.findByID({ collection: 'intake_sessions', id: s.session, ...o })) as Doc
  expect(after.draft).toMatchObject({ title: 'My title', type: 'change', acceptance_criteria: ['One', 'Two'], problem: 'The invoice total is wrong' })
  expect(after).toMatchObject({ title: 'My title', kind: 'change' })
})

it('urgency: only a bug, only with the fast lane on, never for several requests in one; it needs its reason', async () => {
  const s = await start(alice)
  await expect(edit(alice, s.session, { urgency: 'urgent' })).rejects.toThrow('Only a bug can be urgent')
  await edit(alice, s.session, { type: 'bug' })
  expect(await edit(alice, s.session, { urgency: 'urgent' })).toMatchObject({ urgency: 'urgent', canSend: false, missing: expect.arrayContaining(['what is broken, for whom, since when']) })
  expect(await edit(alice, s.session, { urgent_reason: 'Checkout is down for all customers since 9.' })).toMatchObject({ urgentReason: expect.stringContaining('Checkout') })
  expect(await edit(alice, s.session, { type: 'feature' })).toMatchObject({ urgency: 'normal', urgentReason: '' })
  await edit(alice, s.session, { type: 'bug' })
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
  await expect(edit(alice, s.session, { urgency: 'urgent' })).rejects.toThrow('fast lane is off')
  expect((await cardOf(alice, s.session)).fastLane).toBe(false)
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: true }, ...o })
  await expect(edit(alice, 99999999, { title: 'x' })).rejects.toThrow()
})

it('the AI proposes title, type and urgency from an outage; the fake model keeps them on the card', async () => {
  const s = await start(alice)
  await run(s, alice, 'The checkout has an outage')
  expect(await cardOf(alice, s.session)).toMatchObject({ title: 'The checkout has an outage', kind: 'bug', urgency: 'urgent', urgentReason: expect.stringContaining('Nobody can work') })
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
  const off = await start(alice)
  await run(off, alice, 'The checkout has an outage')
  expect(await cardOf(alice, off.session)).toMatchObject({ urgency: 'normal' })
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: true }, ...o })
})

it('a question is answered in the conversation and files nothing until it is turned into a request', async () => {
  const s = await start(alice)
  for (const t of ['Question: where is the export?', 'anyone', 'ok']) await run(s, alice, t)
  expect(await cardOf(alice, s.session)).toMatchObject({ kind: 'question', canSend: true })
  await expect(request.requestFile(who(alice), s.session)).rejects.toThrow('answered in the chat')
  await expect(actions.submitIntake(payload, s.session)).rejects.toThrow('answered in the chat')
  await edit(alice, s.session, { acceptance_criteria: [] })
  expect(await edit(alice, s.session, { type: 'feature' })).toMatchObject({ kind: 'feature', canSend: false, missing: ['at least one "It is done when"'] })
})

it('filing says what is missing otherwise, and files the card exactly as it stands', async () => {
  const s = await start(alice)
  await complete(s.session, { acceptance_criteria: [] })
  await expect(request.requestFile(who(alice), s.session)).rejects.toThrow('draft incomplete: acceptance_criteria')
  await edit(alice, s.session, { acceptance_criteria: ['Totals match'] })
  const view = await request.requestFile(who(alice), s.session)
  expect(view).toMatchObject({ sent: true, status: expect.stringMatching(/^Filed as #\d+\.$/), handoff: { numbers: [expect.any(Number)], ticket: null } })
  expect(view.card).toMatchObject({ sent: true, editable: false })
  expect(await request.requestFile(who(alice), s.session)).toMatchObject({ sent: true }) // filing twice answers the same
})

const labelsOf = async (number: number) => (await fake.tickets(repo).get(String(number))).labels
const byNumber = async (n: number) => (await payload.find({ collection: 'tickets', where: { number: { equals: n } }, limit: 1, ...o })).docs[0] as Doc

it('filing a request puts the type on the issue and the title is the card title; a follow-up says so', async () => {
  const s = await start(alice)
  await complete(s.session, { type: 'change', title: 'Wider export' })
  const { number } = await actions.submitIntake(payload, s.session)
  const issue = await fake.tickets(repo).get(String(number))
  expect(issue.title).toBe('Wider export')
  expect(issue.labels).toEqual(['type:change', 'bauherr:type:change', 'product:web'])
  const next = await start(alice)
  await complete(next.session)
  await payload.update({ collection: 'intake_sessions', id: next.session, data: { followUpOf: s.session }, ...o })
  const again = await actions.submitIntake(payload, next.session)
  expect((await fake.tickets(repo).get(String(again.number))).body).toContain(`Follow-up to #${number}`)
  expect(await cardOf(alice, next.session)).toMatchObject({ followUp: number, sent: true })
})

it('an urgent request of a member asks for the fast lane at once: the proposal label, the Inbox decision with the reason, no Triage Run first', async () => {
  const s = await start(alice)
  await complete(s.session, { urgency: 'urgent', urgent_reason: 'Checkout is down for all customers since 9.' })
  const { number } = await actions.submitIntake(payload, s.session)
  const labels = await labelsOf(number)
  expect(labels).toContain('bauherr:expedite-proposed')
  expect(labels).not.toContain('bauherr:expedite')
  expect((await fake.tickets(repo).get(String(number))).body).toContain('Urgent: Checkout is down')
  await poll()
  const t = await byNumber(number)
  expect(await payload.count({ collection: 'runs', where: { and: [{ ticket: { equals: t.id } }, { status: { equals: 'succeeded' } }] }, ...o })).toMatchObject({ totalDocs: 0 }) // no Triage has finished: the decision does not wait for it
  await gates.syncGates(payload)
  const row = await byNumber(number)
  expect(row).toMatchObject({ needsYou: 'Expedite?', expedite: false })
  expect(row.decision).toMatchObject({ ask: expect.stringContaining('Fast lane for'), why: expect.arrayContaining([expect.stringContaining('Checkout is down for all customers')]) })
  const inbox = await (await import('../src/app/(app)/lib/inbox')).loadInbox(ws, { role: 'admin' })
  expect(inbox.groups[0]!.items[0]!.decision.ask).toContain('Fast lane for')
})

it('an urgent request of an Admin goes on the fast lane directly, vouched for like the button; the lane being off refuses it', async () => {
  const s = await start(root)
  await complete(s.session, { urgency: 'urgent', urgent_reason: 'Nobody can log in since 8.' })
  const { number } = await actions.submitIntake(payload, s.session)
  expect(await labelsOf(number)).toContain('bauherr:expedite')
  expect(await labelsOf(number)).not.toContain('bauherr:expedite-proposed')
  await poll()
  expect(await byNumber(number)).toMatchObject({ expedite: true })
  expect(await payload.count({ collection: 'human_touches', where: { and: [{ kind: { equals: 'expedite' } }, { ticket: { equals: (await byNumber(number)).id } }] }, ...o })).toMatchObject({ totalDocs: 1 })

  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
  const off = await start(root)
  await complete(off.session, { urgency: 'urgent', urgent_reason: 'Down.' })
  await expect(actions.submitIntake(payload, off.session)).rejects.toThrow('fast lane is off')
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: true }, ...o })
})

it('ordering trades the ranks of the person\'s own requests only; foreign or unranked ones are refused', async () => {
  const mk = async (number: number, rank: string, user: User) => {
    const t = (await payload.create({ collection: 'tickets', data: { title: `O${number}`, externalId: `ord-${number}`, number, url: `https://x/${number}`, state: 'open', labels: [], product: web, workspace: ws, rank }, ...o } as never)) as Doc
    await payload.create({ collection: 'intake_sessions', data: { product: web, workspace: ws, status: 'submitted', persona: 'product-user', messages: [], user: user.id, ticketNumber: number }, ...o } as never)
    return t.id as number
  }
  const [a, b, c, theirs, unranked] = [await mk(901, 'a1', alice), await mk(902, 'a5', alice), await mk(903, 'a9', alice), await mk(904, 'a3', root), await mk(905, 'a7', alice)]
  await payload.update({ collection: 'tickets', id: unranked, data: { rank: null }, ...o } as never)
  const ranks = async () => Object.fromEntries((await Promise.all([a, b, c, theirs].map((id) => payload.findByID({ collection: 'tickets', id, ...o })))).map((t: Doc) => [t.number, t.rank]))
  await order.orderOwnRequests(payload, alice, ws, [c, a, b])
  expect(await ranks()).toEqual({ 901: 'a5', 902: 'a9', 903: 'a1', 904: 'a3' })
  await expect(order.orderOwnRequests(payload, alice, ws, [a, theirs])).rejects.toThrow('only order your own')
  await expect(order.orderOwnRequests(payload, alice, ws, [a, unranked])).rejects.toThrow('cannot be ordered')
  await order.orderOwnRequests(payload, alice, ws, [a])
  expect(await ranks()).toEqual({ 901: 'a5', 902: 'a9', 903: 'a1', 904: 'a3' })
})
