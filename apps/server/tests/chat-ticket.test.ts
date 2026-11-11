import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
let payload: Payload
let testDb: TestDb
let actions: typeof import('../src/lib/actions')
let threads: typeof import('../src/lib/chat/threads')
let engine: typeof import('../src/lib/chat/engine')
let fakeModel: typeof import('../src/lib/chat/fake').fakeChatModel
let media: typeof import('../src/lib/intake/media')
let ws: number
let other: number
let alice: Doc
let bob: Doc
let outsider: Doc
let ticket: Doc
let foreign: Doc
const o = { overrideAccess: true } as const
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const who = (user: Doc, workspace: number) => ({ payload, user, workspace })

beforeAll(async () => {
  testDb = await createTestDb('chat_ticket')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.CHAT_FAKE = '1'
  process.env.MEDIA_DIR = `/tmp/bauherr-chat-ticket-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  threads = await import('../src/lib/chat/threads')
  engine = await import('../src/lib/chat/engine')
  fakeModel = (await import('../src/lib/chat/fake')).fakeChatModel
  media = await import('../src/lib/intake/media')
  ;[ws, other] = (await Promise.all(['acme', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))).map((w) => w.id as number) as [number, number]
  const user = (email: string, tenant: number, role = 'bauherr') => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role, tenants: [{ tenant }] }, ...o }) as Promise<Doc>
  await payload.create({ collection: 'bauherren', data: { email: 'root@x.io', password: 'pw-123456', role: 'admin' }, ...o }) // the first Bauherr is made Admin
  ;[alice, bob, outsider] = await Promise.all([user('alice@x.io', ws), user('bob@x.io', ws), user('out@x.io', other)])
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  // #1 of the fake forge carries the open decision rows D1 and D2 (D2 critical).
  ticket = await payload.create({ collection: 'tickets', data: { title: 'Remember the theme choice', externalId: 'e2e-1', number: 1, url: 'https://x/1', state: 'open', labels: [], stage: 'plan', product, workspace: ws }, ...o })
  const pB = (await payload.create({ collection: 'products', data: { name: 'other', slug: 'other', workspace: other }, ...o })).id as number
  foreign = await payload.create({ collection: 'tickets', data: { title: 'Secret of B', externalId: '900', number: 900, state: 'open', stage: 'plan', product: pB, workspace: other }, ...o })
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
const comments = async () => (await (await actions.sourceOf(payload, ticket)).ts.listComments('1')).map((c) => c.body)
const say = (text: string) => [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }]

it('a Ticket thread is created once per person and Ticket, named "#<number> <title>", and comes back from the archive', async () => {
  const a = (await threads.ticketThread(who(alice, ws), ticket.id))!
  expect(a).toMatchObject({ title: '#1 Remember the theme choice', ticket: ticket.id, context: { path: `/tickets/${ticket.id}` }, archived: false })
  expect((await threads.ticketThread(who(alice, ws), String(ticket.id)))!.id).toBe(a.id)
  expect((await Promise.all([1, 2, 3].map(() => threads.ticketThread(who(bob, ws), ticket.id)))).map((m) => m!.id)).toHaveLength(3)
  expect(new Set((await threads.listThreads(who(bob, ws))).filter((t) => t.ticket === ticket.id).map((t) => t.id)).size).toBe(1)
  await threads.updateThread(who(alice, ws), String(a.id), { archived: true })
  expect(await threads.ticketThread(who(alice, ws), ticket.id)).toMatchObject({ id: a.id, archived: false })
  expect((await threads.loadMessages(who(alice, ws), String(a.id)))!.ticket).toBe(ticket.id)
  expect((await threads.listThreads(who(alice, ws))).find((t) => t.id === a.id)).toMatchObject({ title: '#1 Remember the theme choice', ticket: ticket.id })
})

it('a Ticket of another Workspace, or one that does not exist, has no thread', async () => {
  expect(await threads.ticketThread(who(alice, ws), foreign.id)).toBeNull()
  expect(await threads.ticketThread(who(outsider, other), ticket.id)).toBeNull()
  expect(await threads.ticketThread(who(alice, ws), 999999)).toBeNull()
  expect(await threads.ticketThread(who(alice, ws), 'x')).toBeNull()
})

it('answering through the card records the same Decision comment and worklog line as before, critical row first', async () => {
  const thread = (await threads.ticketThread(who(alice, ws), ticket.id))!
  const t = (await threads.loadMessages(who(alice, ws), String(thread.id)))!.ticket!
  const first = await actions.startOwnerIntake(payload, alice, { ticket: t, workspaceId: ws })
  expect(first).toMatchObject({ decision: 'D2', left: 2 })
  const next = await actions.askOwnerIntake(payload, alice, { session: first.session, decision: 'D2', text: first.options[0]!.label, workspaceId: ws })
  expect(next).toMatchObject({ decision: 'D1', left: 1 })
  const done = await actions.askOwnerIntake(payload, alice, { session: first.session, decision: 'D1', text: 'a cookie', workspaceId: ws })
  expect(done).toMatchObject({ done: true })
  const sheet = (await comments()).filter((b) => b.startsWith('<!-- bauherr:decisions -->'))
  expect(sheet).toHaveLength(1)
  expect(sheet[0]).toContain('D2: yes, until the user picks')
  expect(sheet[0]).toContain('D1: a cookie')
  expect((await comments()).find((b) => b.startsWith('<!-- bauherr:worklog -->'))).toContain('D1 Where to store the choice: a cookie')
})

it('post_comment is a confirm tool: the turn stores exactly that call and posts nothing; only the confirmation runs it', async () => {
  const thread = (await threads.ownThread(who(alice, ws), (await threads.ticketThread(who(alice, ws), ticket.id))!.id))!
  const before = (await comments()).length
  const events = await drain(engine.runChat({ payload, user: alice, workspace: ws, thread, messages: say('comment #1: The total is off by one'), context: { label: 'Ticket #1', markdown: '', path: `/tickets/${ticket.id}` }, model: fakeModel }))
  expect(events.map((e) => e.type)).toEqual(['context', 'delta', 'tool-call', 'confirm', 'done'])
  expect(events.find((e) => e.type === 'confirm')).toMatchObject({ name: 'post_comment', title: 'Comment on #1 Remember the theme choice', destructive: false })
  expect(events.find((e) => e.type === 'confirm').details).toContainEqual({ label: 'Comment', value: 'The total is off by one' })
  expect((await comments()).length).toBe(before)
  const pending = ((await payload.findByID({ collection: 'chat_threads', id: thread.id, depth: 0, ...o })) as Doc).pending
  expect(pending).toMatchObject({ name: 'post_comment', input: { ticket: ticket.id, body: 'The total is off by one', workspaceId: ws } })

  const ctx = { label: 'Ticket #1', markdown: '' }
  const resume = (approved: boolean, id: string) => engine.resumeChat({ payload, user: alice, workspace: ws, thread, toolCallId: id, approved, context: ctx, model: fakeModel })
  expect(await resume(true, 'toolu_wrong')).toBeNull()
  const run = await drain((await resume(true, pending.toolCallId))!)
  expect(run.find((e) => e.type === 'tool-result')).toMatchObject({ ok: true })
  expect((await comments()).slice(before)).toEqual(['The total is off by one'])
  expect(await resume(true, pending.toolCallId)).toBeNull()
  expect((await comments()).length).toBe(before + 1)
  expect(await payload.count({ collection: 'tool_calls', where: { name: { equals: 'post_comment' } }, ...o })).toMatchObject({ totalDocs: 1 })
})

it('a declined post_comment posts nothing', async () => {
  const thread = (await threads.ownThread(who(alice, ws), (await threads.ticketThread(who(alice, ws), ticket.id))!.id))!
  const before = (await comments()).length
  await drain(engine.runChat({ payload, user: alice, workspace: ws, thread, messages: say('comment #1: nope'), context: { label: 'x', markdown: '', path: '/' }, model: fakeModel }))
  const pending = ((await payload.findByID({ collection: 'chat_threads', id: thread.id, depth: 0, ...o })) as Doc).pending
  const out = await drain((await engine.resumeChat({ payload, user: alice, workspace: ws, thread, toolCallId: pending.toolCallId, approved: false, reason: 'later', context: { label: 'x', markdown: '' }, model: fakeModel }))!)
  expect(out.find((e) => e.type === 'tool-result')).toMatchObject({ ok: false, result: 'declined by the person: later' })
  expect((await comments()).length).toBe(before)
})

it('the direct comment path posts the text with the chat-uploaded images attached to the Ticket, once', async () => {
  const up = (name: string) => media.saveMedia(payload, { bytes: png, name, workspace: ws })
  const [a, b] = [await up('pasted.png'), await up('dropped.png')]
  const before = (await comments()).length
  const urls = await actions.postCommentFromChat(payload, alice, { ticket: ticket.id, workspaceId: ws, body: 'See these', mediaIds: [a.id, b.id] })
  expect(urls).toHaveLength(2)
  const posted = (await comments()).slice(before)
  expect(posted).toHaveLength(1)
  expect(posted[0]).toMatch(/^See these\n\n!\[/)
  for (const [name, url] of [['pasted.png', urls.find((u) => u.includes(`/m/${a.id}/`))], ['dropped.png', urls.find((u) => u.includes(`/m/${b.id}/`))]]) expect(posted[0]).toContain(`![${name}](${url})`)
  expect(await payload.findByID({ collection: 'media', id: a.id, ...o })).toMatchObject({ ticketNumber: 1, attached: true })
  await expect(actions.postCommentFromChat(payload, alice, { ticket: ticket.id, workspaceId: ws, body: 'again', mediaIds: [a.id] })).rejects.toThrow('missing or already posted')
})

it('the direct comment path refuses an empty comment, too many images, an image of another Workspace and a foreign Ticket', async () => {
  await expect(actions.postCommentFromChat(payload, alice, { ticket: ticket.id, workspaceId: ws, body: ' ', mediaIds: [] })).rejects.toThrow('write a comment')
  const ids = await Promise.all(Array.from({ length: 7 }, (_, i) => media.saveMedia(payload, { bytes: png, name: `i${i}.png`, workspace: ws }).then((m) => m.id)))
  await expect(actions.postCommentFromChat(payload, alice, { ticket: ticket.id, workspaceId: ws, body: 'x', mediaIds: ids })).rejects.toThrow('at most')
  const theirs = (await media.saveMedia(payload, { bytes: png, name: 'theirs.png', workspace: other })).id
  await expect(actions.postCommentFromChat(payload, alice, { ticket: ticket.id, workspaceId: ws, body: 'x', mediaIds: [theirs] })).rejects.toThrow('missing or already posted')
  await expect(actions.postCommentFromChat(payload, outsider, { ticket: foreign.id, workspaceId: ws, body: 'x', mediaIds: [] })).rejects.toThrow()
  expect(await payload.findByID({ collection: 'media', id: theirs, ...o })).toMatchObject({ attached: false })
})
