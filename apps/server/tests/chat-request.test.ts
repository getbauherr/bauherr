import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let testDb: TestDb
let engine: typeof import('../src/lib/chat/engine')
let request: typeof import('../src/lib/chat/request')
let threads: typeof import('../src/lib/chat/threads')
let tools: typeof import('../src/lib/chat/tools')
let media: typeof import('../src/lib/intake/media')
let ws: number
let other: number
let alice: Doc
let bob: Doc
let outsider: Doc
let web: number
let api: number
const o = { overrideAccess: true, depth: 0 } as const
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const who = (user: Doc, workspace: number) => ({ payload, user, workspace })

beforeAll(async () => {
  testDb = await createTestDb('chat_request')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.CHAT_FAKE = '1'
  process.env.MEDIA_DIR = `/tmp/bauherr-chat-request-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  engine = await import('../src/lib/chat/engine')
  request = await import('../src/lib/chat/request')
  threads = await import('../src/lib/chat/threads')
  tools = await import('../src/lib/chat/tools')
  media = await import('../src/lib/intake/media')
  ;[ws, other] = (await Promise.all(['acme', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))).map((w) => w.id as number) as [number, number]
  const user = (email: string, tenant: number, role = 'bauherr') => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role, tenants: [{ tenant }] }, ...o }) as Promise<Doc>
  await payload.create({ collection: 'bauherren', data: { email: 'root@x.io', password: 'pw-123456', role: 'admin' }, ...o }) // the first Bauherr is made Admin
  ;[alice, bob, outsider] = await Promise.all([user('alice@x.io', ws), user('bob@x.io', ws), user('out@x.io', other)])
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  web = (await payload.create({ collection: 'products', data: { name: 'Web', slug: 'web', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product: web, connection, workspace: ws }, ...o })
  await payload.create({ collection: 'products', data: { name: 'Elsewhere', slug: 'elsewhere', workspace: other }, ...o })
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const drain = async (g: AsyncGenerator<any>): Promise<any[]> => {
  const out: any[] = []
  for await (const e of g) out.push(e)
  return out
}
const say = (text: string, images: number[] = []) => [{ role: 'user' as const, content: [{ type: 'text' as const, text }, ...images.map((mediaId) => ({ type: 'image' as const, mediaId }))] }]
const thread = async (id: number | string, user = alice, workspace = ws) => (await threads.ownThread(who(user, workspace), id))!
const run = async (id: number, text: string, images: number[] = [], user = alice) => drain(request.runRequest({ ...who(user, ws), thread: await thread(id, user), messages: say(text, images) }))
const tickets = async () => (await payload.count({ collection: 'intake_sessions', where: { status: { equals: 'submitted' } }, ...o })).totalDocs

it('a member gets a request thread; with one Product the interview session starts at once and an empty thread is reused', async () => {
  const t = (await request.newRequestThread(who(alice, ws)))!
  expect(t).toMatchObject({ request: true })
  const info = (await request.requestInfo(who(alice, ws), t))!
  expect(info).toMatchObject({ product: 'Web', sent: false, products: [] })
  expect(info.session).toBeGreaterThan(0)
  expect((await request.newRequestThread(who(alice, ws)))!.id).toBe(t.id)
  expect((await request.newRequestThread(who(bob, ws)))!.id).not.toBe(t.id)
  expect((await threads.loadMessages(who(alice, ws), String(t.id)))!.messages).toEqual([])
  expect((await threads.listThreads(who(alice, ws))).find((x) => x.id === t.id)).toMatchObject({ request: true })
  expect(await payload.findByID({ collection: 'intake_sessions', id: info.session!, ...o })).toMatchObject({ persona: 'product-user', status: 'open' })
})

it('a Workspace without a Product has no request thread', async () => {
  const empty = Number((await payload.create({ collection: 'workspaces', data: { name: 'e', slug: 'e' }, ...o })).id)
  expect(await request.newRequestThread(who(alice, empty))).toBeNull()
})

it('with several Products the thread waits for the choice, which must be a Product of the Workspace and sticks', async () => {
  api = (await payload.create({ collection: 'products', data: { name: 'Api', slug: 'api', workspace: ws }, ...o })).id as number
  bob = (await payload.create({ collection: 'bauherren', data: { email: 'carol@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })) as Doc
  const t = (await request.newRequestThread(who(bob, ws)))!
  expect(await request.requestInfo(who(bob, ws), t)).toMatchObject({ session: null, product: null, productId: null, products: [{ name: 'Api' }, { name: 'Web' }] })
  expect((await run(t.id, 'Hello', [], bob))[0]).toMatchObject({ type: 'delta', text: expect.stringContaining('Choose a product first') })
  const foreign = (await payload.find({ collection: 'products', where: { slug: { equals: 'elsewhere' } }, ...o })).docs[0]!.id as number
  expect(await request.chooseProduct(who(bob, ws), t.id, foreign)).toBeNull()
  expect(await request.chooseProduct(who(alice, ws), t.id, api)).toBeNull()
  const chosen = (await request.chooseProduct(who(bob, ws), t.id, api))!
  expect(chosen.product).toBe('Api')
  expect(await request.requestInfo(who(bob, ws), await thread(t.id, bob))).toMatchObject({ session: chosen.session, product: 'Api', productId: api, products: [{ name: 'Api' }, { name: 'Web' }] })
  expect(await request.chooseProduct(who(bob, ws), t.id, web)).toEqual({ session: chosen.session, product: 'Web' })
  await run(t.id, 'Hello', [], bob)
  expect(await request.chooseProduct(who(bob, ws), t.id, api)).toEqual({ session: chosen.session, product: 'Web' })
  expect(await request.requestInfo(who(bob, ws), await thread(t.id, bob))).toMatchObject({ product: 'Web', products: [] })
})

it('the interview runs in the thread, a ready draft ends in a confirm card, declining sends nothing and approving creates the request once', async () => {
  const t = (await request.newRequestThread(who(alice, ws)))!
  const first = await run(t.id, 'The invoice total is wrong')
  expect(first.map((e) => e.type)).toEqual(['delta', 'done'])
  expect(first[0].text).toBe('Who is affected, and since when?')
  expect((await run(t.id, 'Finance, last week')).map((e) => e.type)).toEqual(['delta', 'done'])
  const third = await run(t.id, 'Totals should match')
  expect(third.map((e) => e.type)).toEqual(['delta', 'tool-call', 'confirm', 'done'])
  expect(third.find((e) => e.type === 'confirm')).toMatchObject({ name: 'submit_request', title: 'Send this request', approve: 'Create request', decline: 'Keep editing', noReason: true, destructive: false })
  const card = third.find((e) => e.type === 'confirm')
  expect(card.details).toContainEqual({ label: 'Product', value: 'Web' })
  expect(card.details).toContainEqual({ label: 'Request', value: 'The invoice total is wrong' })
  expect(await tickets()).toBe(0)
  const pending = ((await payload.findByID({ collection: 'chat_threads', id: t.id, ...o })) as Doc).pending
  expect(pending).toMatchObject({ name: 'submit_request', input: { session: expect.any(Number) } })

  const resume = async (approved: boolean, id: string) => {
    const g = await engine.resumeChat({ ...who(alice, ws), thread: await thread(t.id), toolCallId: id, approved, context: { label: 'x', markdown: '' }, model: async function* () {} })
    return g && drain(g)
  }
  expect(await resume(true, 'wrong')).toBeNull()
  const declined = (await resume(false, pending.toolCallId))!
  expect(declined.find((e) => e.type === 'tool-result')).toMatchObject({ ok: false, result: expect.stringContaining('Not sent') })
  expect(declined.map((e) => e.type)).toEqual(['context', 'tool-result', 'done'])
  expect(await tickets()).toBe(0)
  expect(await resume(true, pending.toolCallId)).toBeNull()

  const again = await run(t.id, 'And the totals on the export')
  expect(again.map((e) => e.type)).toContain('confirm')
  const id2 = ((await payload.findByID({ collection: 'chat_threads', id: t.id, ...o })) as Doc).pending.toolCallId
  const approved = (await resume(true, id2))!
  const sent = approved.find((e) => e.type === 'tool-result')
  expect(sent).toMatchObject({ ok: true, result: expect.stringMatching(/^Request #\d+ sent/), href: expect.stringMatching(/^\/requests\/\d+$/) })
  expect(await tickets()).toBe(1)
  expect(await resume(true, id2)).toBeNull()
  expect(await tickets()).toBe(1)
  const info = (await request.requestInfo(who(alice, ws), await thread(t.id)))!
  expect(sent.href).toBe(`/requests/${info.session}`)
  expect(info.sent).toBe(true)
  expect((await run(t.id, 'one more thing'))[0].text).toContain('already sent')
  expect(await payload.count({ collection: 'tool_calls', where: { name: { equals: 'submit_request' } }, ...o })).toMatchObject({ totalDocs: 1 })
})

it('the stored call runs only for the person whose session it is, and only inside their Workspace', async () => {
  const t = (await request.newRequestThread(who(alice, ws)))!
  await request.chooseProduct(who(alice, ws), t.id, web)
  const session = (await request.requestInfo(who(alice, ws), t))!.session!
  const ctx = (user: Doc, workspace: number) => ({ payload, user, actor: { kind: 'human' as const }, workspace })
  await expect(tools.runChatTool(ctx(bob, ws), 'submit_request', { session })).rejects.toThrow()
  await expect(tools.runChatTool(ctx(outsider, other), 'submit_request', { session })).rejects.toThrow()
  expect(await request.requestThread(who(bob, ws), session)).toBeNull()
  expect(await request.requestThread(who(outsider, other), session)).toBeNull()
  expect(await request.requestThread(who(alice, ws), 99999999)).toBeNull()
  expect(await request.requestThread(who(alice, ws), 'x')).toBeNull()
  expect(await tickets()).toBe(1)
})

it('a pasted screenshot becomes the session\'s screenshot, counted and capped, and a foreign one is refused', async () => {
  const t = (await request.newRequestThread(who(alice, ws)))!
  await request.chooseProduct(who(alice, ws), t.id, web)
  const session = (await request.requestInfo(who(alice, ws), await thread(t.id)))!.session!
  const shot = (name: string, workspace = ws) => media.saveMedia(payload, { bytes: png, name, workspace }).then((m) => m.id as number)
  const a = await shot('a.png')
  const events = await run(t.id, 'The shot check is broken', [a])
  expect(events.map((e) => e.type)).toEqual(['delta', 'done'])
  expect(await payload.findByID({ collection: 'media', id: a, ...o })).toMatchObject({ session })
  expect(await payload.findByID({ collection: 'intake_sessions', id: session, ...o })).toMatchObject({ screenshots: 1 })
  const theirs = await shot('theirs.png', other)
  expect((await run(t.id, 'Finance', [theirs])).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('missing') })
  expect(await payload.findByID({ collection: 'media', id: theirs, ...o })).not.toHaveProperty('session', session)
  process.env.MEDIA_MAX_PER_SESSION = '1'
  expect((await run(t.id, 'Finance', [await shot('b.png')])).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('At most 1') })
  delete process.env.MEDIA_MAX_PER_SESSION
})

it('reopening a request opens its own thread, once, with its interview as messages; a sent request too', async () => {
  const mk = (extra: Doc) => payload.create({ collection: 'intake_sessions', data: { product: web, workspace: ws, persona: 'product-user', status: 'open', user: alice.id, draft: { problem: 'Old draft', context: '', acceptance_criteria: [], type: 'bug', links: [] }, messages: [{ role: 'user', content: 'Old draft' }, { role: 'assistant', content: 'Who is affected?' }], ...extra }, ...o }).then((s) => Number(s.id))
  const open = await mk({})
  const a = (await request.requestThread(who(alice, ws), open))!
  expect((await request.requestThread(who(alice, ws), String(open)))!.id).toBe(a.id)
  expect(a).toMatchObject({ request: true, title: 'Old draft' })
  const loaded = (await threads.loadMessages(who(alice, ws), String(a.id)))!
  expect(loaded.messages.map((m) => [m.message.role, m.message.content[0].text])).toEqual([['user', 'Old draft'], ['assistant', 'Who is affected?']])
  expect(loaded.messages[1]!.parentId).toBe(loaded.messages[0]!.message.id)
  await threads.updateThread(who(alice, ws), String(a.id), { archived: true })
  expect((await request.requestThread(who(alice, ws), open))!.archivedAt).toBeNull()
  const sent = await mk({ status: 'submitted', ticketNumber: 1 })
  expect(await request.requestInfo(who(alice, ws), (await request.requestThread(who(alice, ws), sent))!)).toMatchObject({ session: sent, sent: true })
  expect(await request.requestThread(who(alice, ws), await mk({ status: 'abandoned' }))).toBeNull()
  expect(await request.requestThread(who(alice, ws), await mk({ persona: 'owner' }))).toBeNull()
})

it('New request never resumes a conversation: a thread that has messages is left alone, an empty one is reused, other empty ones go', async () => {
  const user = (await payload.create({ collection: 'bauherren', data: { email: 'dana@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })) as Doc
  const first = (await request.newRequestThread(who(user, ws)))!
  await request.chooseProduct(who(user, ws), first.id, web)
  await run(first.id, 'The first draft is broken', [], user)
  const second = (await request.newRequestThread(who(user, ws)))!
  expect(second.id).not.toBe(first.id)
  expect((await threads.loadMessages(who(user, ws), String(second.id)))!.messages).toEqual([])
  expect((await request.newRequestThread(who(user, ws)))!.id).toBe(second.id)
  await request.chooseProduct(who(user, ws), second.id, api)
  await run(second.id, 'The second draft is broken', [], user)
  const third = (await request.newRequestThread(who(user, ws)))!
  expect([first.id, second.id]).not.toContain(third.id)
  expect((await threads.loadMessages(who(user, ws), String(third.id)))!.messages).toEqual([])
  const mine = (await threads.listThreads(who(user, ws))).filter((t) => t.request)
  expect(mine.map((t) => t.id).sort()).toEqual([first.id, second.id, third.id].sort())
  const drafts = (await payload.find({ collection: 'intake_sessions', where: { user: { equals: user.id } }, ...o })).docs
  expect(drafts.map((d) => d.status)).toEqual(expect.arrayContaining(['open']))
})

it('empty request threads are not kept: a stale one goes with its empty session, one with messages stays', async () => {
  const user = (await payload.create({ collection: 'bauherren', data: { email: 'erin@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })) as Doc
  const empty = (await request.newRequestThread(who(user, ws)))!
  await request.chooseProduct(who(user, ws), empty.id, web)
  const emptySession = (await request.requestInfo(who(user, ws), await thread(empty.id, user)))!.session!
  const [full] = await Promise.all([payload.create({ collection: 'chat_threads', data: { owner: user.id, workspace: ws, request: true, lastMessageAt: new Date().toISOString() }, ...o }) as Promise<Doc>])
  await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`INSERT INTO chat_messages (workspace_id, thread_id, message_id, role) VALUES (${ws}, ${full.id}, 'm1', 'user')`)
  expect(await request.pruneEmptyRequests(payload, { owner: user.id })).toBe(0) // too recent
  expect(await request.pruneEmptyRequests(payload, { owner: user.id, olderThanMs: 0 })).toBe(1)
  expect((await threads.listThreads(who(user, ws))).filter((t) => t.request).map((t) => t.id)).toEqual([full.id])
  expect((await payload.count({ collection: 'intake_sessions', where: { id: { equals: emptySession } }, ...o })).totalDocs).toBe(0)
  const keep = await payload.create({ collection: 'intake_sessions', data: { product: web, workspace: ws, persona: 'product-user', status: 'open', user: user.id, messages: [{ role: 'user', content: 'hi' }], draft: { problem: 'p', context: '', acceptance_criteria: [], type: 'bug', links: [] } }, ...o })
  await payload.create({ collection: 'chat_threads', data: { owner: user.id, workspace: ws, request: true, intakeSession: keep.id, lastMessageAt: new Date().toISOString() }, ...o })
  expect(await request.pruneEmptyRequests(payload, { olderThanMs: 0 })).toBeGreaterThanOrEqual(1) // the thread without messages, whoever's
  expect((await payload.count({ collection: 'intake_sessions', where: { id: { equals: keep.id } }, ...o })).totalDocs).toBe(1) // a session that was written to is never deleted with its thread
})

it('discarding a draft abandons its session and deletes its thread; only the owner can', async () => {
  const user = (await payload.create({ collection: 'bauherren', data: { email: 'finn@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })) as Doc
  const t = (await request.newRequestThread(who(user, ws)))!
  await request.chooseProduct(who(user, ws), t.id, web)
  await run(t.id, 'A draft to throw away', [], user)
  const session = (await request.requestInfo(who(user, ws), await thread(t.id, user)))!.session!
  await expect(request.discardRequest(who(alice, ws), session)).rejects.toThrow()
  await request.discardRequest(who(user, ws), session)
  expect(await payload.findByID({ collection: 'intake_sessions', id: session, ...o })).toMatchObject({ status: 'abandoned' })
  expect(await threads.ownThread(who(user, ws), t.id)).toBeNull()
  expect((await payload.count({ collection: 'chat_messages', where: { thread: { equals: t.id } }, ...o })).totalDocs).toBe(0)
  await expect(request.discardRequest(who(user, ws), session)).rejects.toThrow()
})
