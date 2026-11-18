import { fileURLToPath } from 'node:url'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const session = vi.hoisted(() => ({ cookie: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true, depth: 0 } as const
const repo = 'acme/web'
let payload: Payload
let testDb: TestDb
let fake: FakeBackend
let workspace: number
let product: number
let ticket: number
let other: number
let run: number
let foreign: number
let admin: Record<string, any>

const mk = async (ws: number, prod: number, n: number) =>
  (await payload.create({ collection: 'tickets', data: { title: `T${n}`, externalId: `e${n}`, number: n, url: `https://x/${n}`, state: 'open', labels: [], stage: 'build', product: prod, workspace: ws }, ...o })).id as number

beforeAll(async () => {
  testDb = await createTestDb('ticket_live_api')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  workspace = (await payload.create({ collection: 'workspaces', data: { name: 'a', slug: 'a', wipLimits: {} }, ...o })).id as number
  product = (await payload.create({ collection: 'products', data: { name: 'p', slug: 'p', workspace }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace }, ...o })
  const ws2 = (await payload.create({ collection: 'workspaces', data: { name: 'b', slug: 'b' }, ...o })).id as number
  const product2 = (await payload.create({ collection: 'products', data: { name: 'q', slug: 'q', workspace: ws2 }, ...o })).id as number
  ticket = await mk(workspace, product, 1)
  other = await mk(workspace, product, 2)
  foreign = await mk(ws2, product2, 3)
  run = (await payload.create({ collection: 'runs', data: { ticket, stage: 'build', status: 'running', mode: 'autonomous', workspace }, ...o })).id as number
  admin = await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: 'pw-123456', role: 'admin', githubLogin: 'owner' }, ...o })
  session.cookie = `bauherr-session=${signSession(admin.id, 0)}`
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) })
const live = async (id = ticket) => (await import('../src/app/api/tickets/[id]/live/route')).GET(new Request('http://x/'), ctx(id))
const version = async (id = ticket): Promise<number> => ((await live(id)).json() as Promise<{ v: number }>).then((r) => r.v)
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms))

it('live: moves for a Step of this Ticket, not for another Ticket or Workspace', async () => {
  const v0 = await version()
  await wait()
  await payload.update({ collection: 'tickets', id: other, data: { title: 'changed' }, ...o })
  await payload.update({ collection: 'tickets', id: foreign, data: { title: 'changed' }, ...o })
  expect(await version()).toBe(v0)
  await payload.create({ collection: 'steps', data: { run, seq: 1, summary: 'Read the plan', workspace }, ...o })
  const v1 = await version()
  expect(v1).toBeGreaterThan(v0)
  await wait()
  await payload.create({ collection: 'human_touches', data: { ticket, workspace, kind: 'gate:plan', actor: 'a', at: new Date().toISOString() } as never, ...o })
  expect(await version()).toBeGreaterThan(v1)
})

it('live and events: 404 for a Ticket outside the Workspace, 401 without a session', async () => {
  expect((await live(foreign)).status).toBe(404)
  expect((await live(999999)).status).toBe(404)
  const { GET } = await import('../src/app/api/tickets/[id]/events/route')
  expect((await GET(new Request('http://x/'), ctx(foreign))).status).toBe(404)
  const saved = session.cookie
  session.cookie = ''
  expect((await live()).status).toBe(401)
  expect((await GET(new Request('http://x/'), ctx(ticket))).status).toBe(401)
  session.cookie = saved
})

it('events: a Step created after connect arrives as a milestone; no forge call', async () => {
  const { GET } = await import('../src/app/api/tickets/[id]/events/route')
  const spies = [vi.spyOn(fake.forge, 'getPullRequest'), vi.spyOn(fake.tickets(repo), 'listComments'), vi.spyOn(fake.tickets(repo), 'get')]
  const ac = new AbortController()
  const res = await GET(new Request('http://x/', { signal: ac.signal }), ctx(ticket))
  expect(res.headers.get('content-type')).toBe('text/event-stream')
  const reader = res.body!.getReader()
  await payload.create({ collection: 'steps', data: { run, seq: 2, summary: 'Wrote the test', workspace }, ...o })
  let text = ''
  const dec = new TextDecoder()
  while (!text.includes('Wrote the test')) {
    const { value, done } = await reader.read()
    if (done) break
    text += dec.decode(value)
  }
  ac.abort()
  expect(text).toContain('event: milestone')
  expect(text).toMatch(/"kind":"step"/)
  expect(text).toMatch(/\nid: \d+:step:\d+\n/)
  for (const s of spies) expect(s).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it('events: Last-Event-ID replays what came after the cursor, newest events included', async () => {
  const { GET } = await import('../src/app/api/tickets/[id]/events/route')
  await payload.create({ collection: 'ticket_events', data: { ticket, workspace, at: new Date().toISOString(), stage: 'build', phase: 'ci', cause: 'x' } as never, ...o })
  const ac = new AbortController()
  const res = await GET(new Request('http://x/', { signal: ac.signal, headers: { 'last-event-id': '0:step:0' } }), ctx(ticket))
  const reader = res.body!.getReader()
  let text = ''
  const dec = new TextDecoder()
  while (!text.includes('"kind":"event"')) {
    const { value, done } = await reader.read()
    if (done) break
    text += dec.decode(value)
  }
  ac.abort()
  expect(text).toContain('Read the plan')
  expect(text).toContain('Wrote the test')
  expect(text).toContain('"kind":"event"')
})

const PLAN = '<!-- bauherr:plan -->\n## Goal\n- g\n\n## Decisions\n- **D1 Name the thing?** Default: a. Alternative: b.\n'

it('decisions: approvePlan stores the rows; later answers do not change what the chips show', async () => {
  const actions = await import('../src/lib/actions')
  const jobs = await import('../src/jobs')
  const { decisionsShown, decisionView, parseAnswers, parseDecisions } = await import('../src/app/(app)/lib/plan')
  fake.actingAs = 'factory'
  const t = await fake.tickets(repo).create({ title: 'x', labels: ['bauherr:stage:plan'] })
  await fake.tickets(repo).comment(t.id, PLAN)
  await (jobs.pollTickets.handler as (a: unknown) => Promise<unknown>)({ req: { payload } })
  const row = (await payload.find({ collection: 'tickets', where: { number: { equals: Number(t.id) } }, limit: 1, ...o })).docs[0] as Record<string, any>
  await actions.approvePlan(payload, admin, { ticket: row.id })
  const stored = ((await payload.findByID({ collection: 'tickets', id: row.id, ...o })) as Record<string, any>).decisionsAtApproval
  expect(stored).toEqual([{ id: 'D1', title: 'Name the thing?', status: 'default', default: 'a' }])
  const at = { stageKind: 'build' as never, approved: true }
  const shown = decisionsShown(stored, parseDecisions(PLAN), parseAnswers('D1: b'), true)
  expect(decisionView(shown.decisions, shown.answers, at).defaults.map((d) => d.id)).toEqual(['D1'])
  const unfrozen = decisionsShown(null, parseDecisions(PLAN), parseAnswers('D1: b'), true)
  expect(decisionView(unfrozen.decisions, unfrozen.answers, at).defaults).toEqual([])
})
