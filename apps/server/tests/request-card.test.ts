import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
type User = Doc & { id: number }
let payload: Payload
let testDb: TestDb
let fake: FakeBackend
let request: typeof import('../src/lib/chat/request')
let threads: typeof import('../src/lib/chat/threads')
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
  request = await import('../src/lib/chat/request')
  threads = await import('../src/lib/chat/threads')
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
const drain = async (g: AsyncGenerator<any>): Promise<any[]> => {
  const out: any[] = []
  for await (const e of g) out.push(e)
  return out
}
const say = (text: string) => [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }]
const start = async (user: User) => {
  const session = (await payload.create({ collection: 'intake_sessions', data: { product: web, workspace: ws, persona: 'product-user', status: 'open', messages: [], user: user.id }, ...o })).id as number
  return { thread: (await request.requestThread(who(user), session))!.id as number, session }
}
const run = async (s: { thread: number }, user: User, text: string) => drain(request.runRequest({ ...who(user), thread: (await threads.ownThread(who(user), s.thread))!, messages: say(text) }))
const complete = (session: number, extra: Doc = {}) =>
  payload.update({ collection: 'intake_sessions', id: session, data: { draft: { title: 'Totals wrong', problem: 'The invoice total is wrong', context: 'Invoices page', acceptance_criteria: ['Totals match'], type: 'bug', links: [], ...extra }, messages: [{ role: 'user', content: 'x' }] }, ...o })

it('a hand edit of the card is stored, kept by the next interview turn and the model sees it', async () => {
  const s = await start(alice)
  const card = await request.editCard(who(alice), s.session, { title: 'My title', type: 'change', acceptance_criteria: ['  One  ', '', 'Two'] })
  expect(card).toMatchObject({ title: 'My title', kind: 'change', criteria: ['One', 'Two'], editable: true })
  expect(await payload.findByID({ collection: 'intake_sessions', id: s.session, ...o })).toMatchObject({ title: 'My title', kind: 'change', edited: ['title', 'type', 'acceptance_criteria'] })
  await run(s, alice, 'The invoice total is wrong')
  const after = (await payload.findByID({ collection: 'intake_sessions', id: s.session, ...o })) as Doc
  expect(after.draft).toMatchObject({ title: 'My title', type: 'change', acceptance_criteria: ['One', 'Two'], problem: 'The invoice total is wrong' })
  expect(after).toMatchObject({ title: 'My title', kind: 'change' })
})

it('urgency: only a bug, only with the fast lane on, never for several requests in one; it needs its reason', async () => {
  const s = await start(alice)
  await expect(request.editCard(who(alice), s.session, { urgency: 'urgent' })).rejects.toThrow('Only a bug can be urgent')
  await request.editCard(who(alice), s.session, { type: 'bug' })
  expect(await request.editCard(who(alice), s.session, { urgency: 'urgent' })).toMatchObject({ urgency: 'urgent', canSend: false, missing: expect.arrayContaining(['what is broken, for whom, since when']) })
  expect(await request.editCard(who(alice), s.session, { urgent_reason: 'Checkout is down for all customers since 9.' })).toMatchObject({ urgentReason: expect.stringContaining('Checkout') })
  expect(await request.editCard(who(alice), s.session, { type: 'feature' })).toMatchObject({ urgency: 'normal', urgentReason: '' })
  await request.editCard(who(alice), s.session, { type: 'bug' })
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
  await expect(request.editCard(who(alice), s.session, { urgency: 'urgent' })).rejects.toThrow('fast lane is off')
  expect((await request.requestCard(who(alice), s.session))!.fastLane).toBe(false)
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: true }, ...o })
  await expect(request.editCard(who(alice), 99999999, { title: 'x' })).rejects.toThrow()
})

it('the AI proposes title, type and urgency from an outage; the fake model keeps them on the card', async () => {
  const s = await start(alice)
  await run(s, alice, 'The checkout has an outage')
  expect(await request.requestCard(who(alice), s.session)).toMatchObject({ title: 'The checkout has an outage', kind: 'bug', urgency: 'urgent', urgentReason: expect.stringContaining('Nobody can work') })
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: false }, ...o })
  const off = await start(alice)
  await run(off, alice, 'The checkout has an outage')
  expect(await request.requestCard(who(alice), off.session)).toMatchObject({ urgency: 'normal' })
  await payload.update({ collection: 'workspaces', id: ws, data: { expediteLane: true }, ...o })
})

it('a question is answered in the thread and files nothing until it is turned into a request', async () => {
  const s = await start(alice)
  for (const t of ['Question: where is the export?', 'anyone', 'ok']) expect((await run(s, alice, t)).map((e) => e.type)).not.toContain('confirm')
  expect(await request.requestCard(who(alice), s.session)).toMatchObject({ kind: 'question', canSend: true })
  const send = await run(s, alice, 'Send this request to the factory.')
  expect(send[0].text).toContain('answered here and files nothing')
  await expect(actions.submitIntake(payload, s.session)).rejects.toThrow('answered in the chat')
  await request.editCard(who(alice), s.session, { acceptance_criteria: [] })
  expect(await request.editCard(who(alice), s.session, { type: 'feature' })).toMatchObject({ kind: 'feature', canSend: false, missing: ['at least one "It is done when"'] })
})

it('"Send to the factory" makes the confirmation card without a model call and says what is missing otherwise', async () => {
  const s = await start(alice)
  await complete(s.session, { acceptance_criteria: [] })
  expect((await run(s, alice, 'Send this request to the factory.'))[0].text).toBe('Not ready to send yet. Still needed: what should happen instead.')
  await request.editCard(who(alice), s.session, { acceptance_criteria: ['Totals match'] })
  const events = await run(s, alice, 'Send this request to the factory.')
  expect(events.map((e) => e.type)).toEqual(['delta', 'tool-call', 'confirm', 'done'])
  expect(events.find((e) => e.type === 'confirm').details).toContainEqual({ label: 'Type', value: 'Bug' })
  expect(((await payload.findByID({ collection: 'intake_sessions', id: s.session, ...o })) as Doc).messages).toHaveLength(1)
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
  expect(await request.requestCard(who(alice), next.session)).toMatchObject({ followUp: number, sent: true })
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
