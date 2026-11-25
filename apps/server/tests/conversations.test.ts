import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  attachmentAdapter,
  refusalOf,
  toThreadMessage,
} from '../src/app/(app)/components/conversation/conversation-adapter'
import { conversationApi, type Fetcher } from '../src/app/(app)/components/conversation/conversation-api'
import { FILE_MAX_BYTES } from '../src/core/conversations/limits'
import { PNG } from './core/images'
import { openCoreDb, type CoreDb } from './core/db'

type Person = { role: string; assignments?: unknown[] }
type State = { person: Person | null; workspaces: { id: number; slug: string }[]; payload: unknown }
const state = vi.hoisted((): State => ({ person: null, workspaces: [], payload: null }))

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }))
vi.mock('../src/app/(app)/lib/session', () => ({
  WS_COOKIE: 'bauherr-ws',
  getPerson: () => Promise.resolve(state.person),
  workspacesOf: () => Promise.resolve(state.workspaces),
  payloadClient: () => Promise.resolve(state.payload),
}))

let db: CoreDb
beforeAll(async () => {
  db = await openCoreDb('conversations')
  state.payload = db.payload
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

const signIn = (role: string, workspaces: number[]) => {
  state.person = { role }
  state.workspaces = workspaces.map((id) => ({ id, slug: `w${id}` }))
}

const calls: string[] = []
const routed: Fetcher = async (input, init) => {
  calls.push(input)
  const req = new Request(new URL(input, 'http://factory.test'), init)
  const [, , root, id, files, fileId] = new URL(req.url).pathname.split('/')
  if (root === 'conversations' && id === undefined) {
    return (await import('../src/app/api/conversations/route')).POST(req)
  }
  const params = Promise.resolve({ id: id ?? '', fileId: fileId ?? '' })
  if (files === undefined) {
    const route = await import('../src/app/api/conversations/[id]/route')
    return (req.method === 'GET' ? route.GET : route.POST)(req, { params })
  }
  if (fileId === undefined) {
    return (await import('../src/app/api/conversations/[id]/files/route')).POST(req, { params })
  }
  return (await import('../src/app/api/conversations/[id]/files/[fileId]/route')).GET(req, { params })
}

const api = conversationApi(routed)
const png = (bytes: number): File =>
  new File([PNG, Buffer.alloc(bytes - PNG.length)], 'shot.png', { type: 'image/png' })
const rows = async (query: ReturnType<typeof sql>) => (await db.payload.db.drizzle.execute(query)).rows
const reason = z.object({ error: z.string() })

const post = (id: number, body: BodyInit, headers: Record<string, string>) =>
  routed(`/api/conversations/${id}/files`, { method: 'POST', body, headers })

describe('the conversation, its adapter and its API', () => {
  it('stores messages and attachments in the factory tables and reads them back, calling only /api', async () => {
    signIn('bauherr', [db.workspace])
    calls.length = 0
    const id = await api.create(undefined, 'Test conversation')
    const adapter = attachmentAdapter(() => Promise.resolve(id), api)
    const pending = await adapter.add({ file: png(PNG.length + 10) })
    expect(pending.status).toEqual({ type: 'requires-action', reason: 'composer-send' })
    await api.send(id, 'Here is the screenshot', [Number(pending.id)])
    await api.send(id, 'And a second note', [])

    const [first, second] = await api.messages(id)
    expect(first).toMatchObject({ role: 'user', text: 'Here is the screenshot', files: [{ contentType: 'image/png' }] })
    expect(second).toMatchObject({ text: 'And a second note', files: [] })
    const sent = toThreadMessage(id, first)
    const image = { type: 'image', image: `/api/conversations/${id}/files/${pending.id}` }
    expect(sent.attachments?.[0]?.content).toEqual([image])

    const texts = await rows(
      sql`SELECT "text" FROM "conversation_messages" WHERE "conversation_id" = ${id} ORDER BY "id"`,
    )
    expect(texts).toEqual([{ text: 'Here is the screenshot' }, { text: 'And a second note' }])
    const stored = await rows(
      sql`SELECT "workspace_id", "message_id" FROM "conversation_files" WHERE "id" = ${pending.id}`,
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]?.workspace_id).toBe(db.workspace)
    expect(stored[0]?.message_id).not.toBeNull()
    expect(calls.every((call) => call.startsWith('/api/conversations'))).toBe(true)
  })

  it('refuses a file the adapter should not send, without calling the API', async () => {
    const before = calls.length
    const adapter = attachmentAdapter(() => Promise.resolve(1), api)
    const exe = new File(['MZ'], 'setup.exe', { type: 'application/x-msdownload' })
    const added = await adapter.add({ file: exe })
    expect(added.status).toMatchObject({ type: 'incomplete', reason: 'error' })
    expect(refusalOf({ size: FILE_MAX_BYTES + 1, type: 'image/png' })).toMatch(/10 MB/)
    expect(calls.length).toBe(before)
  })

  it('refuses a file already sent with another message', async () => {
    signIn('bauherr', [db.workspace])
    const id = await api.create(undefined, 'Reuse')
    const stored = await api.upload(id, png(PNG.length + 4))
    await api.send(id, 'once', [stored.id])
    await expect(api.send(id, 'twice', [stored.id])).rejects.toThrow(/already sent/)
  })
})

describe('attached files', () => {
  it('accepts a 10 MB PNG and refuses 11 MB and an .exe with a message', async () => {
    signIn('bauherr', [db.workspace])
    const id = await api.create(undefined, 'Limits')
    const ok = await post(id, png(FILE_MAX_BYTES), { 'Content-Type': 'image/png' })
    expect(ok.status).toBe(201)
    const big = await post(id, png(11 * 1024 * 1024), { 'Content-Type': 'image/png' })
    expect(big.status).toBe(413)
    expect(reason.parse(await big.json()).error).toMatch(/10 MB/)
    const exe = await post(id, Buffer.from('MZ\u0090\u0000'), { 'Content-Type': 'application/x-msdownload' })
    expect(exe.status).toBe(415)
    expect(reason.parse(await exe.json()).error).toMatch(/images.*PDF and text/)
    const lie = await post(id, Buffer.from('MZ\u0090\u0000'), { 'Content-Type': 'text/plain' })
    expect(lie.status).toBe(415)
    expect((await post(id, Buffer.from('%PDF-1.7 x'), { 'Content-Type': 'application/pdf' })).status).toBe(201)
    expect((await post(id, Buffer.from('plain words'), { 'Content-Type': 'text/plain' })).status).toBe(201)
  })

  it('is private: signed out gets 401, another workspace and a product owner get 404', async () => {
    signIn('bauherr', [db.workspace])
    const id = await api.create(undefined, 'Private')
    const stored = await api.upload(id, png(PNG.length + 4))
    const url = `/api/conversations/${id}/files/${stored.id}`
    expect((await routed(url)).status).toBe(200)

    state.person = null
    expect((await routed(url)).status).toBe(401)
    expect((await routed(`/api/conversations/${id}`)).status).toBe(401)

    signIn('bauherr', [db.otherWorkspace])
    expect((await routed(url)).status).toBe(404)
    signIn('product-owner', [db.workspace])
    expect((await routed(url)).status).toBe(404)
  })
})

describe('the files of a request conversation', () => {
  const owner = (workspace: number, products: number[]) => {
    state.person = { role: 'product-owner', assignments: [{ workspace, scope: 'products', products }] }
  }

  it('may be uploaded and read by a product owner of the request product and by no other', async () => {
    const recordId = await db.fresh()
    signIn('bauherr', [db.workspace])
    const id = await api.create(undefined, 'Request comments', recordId)

    owner(db.workspace, [db.product])
    const stored = await api.upload(id, png(PNG.length + 4))
    expect((await routed(`/api/conversations/${id}/files/${stored.id}`)).status).toBe(200)
    expect((await routed(`/api/conversations/${id}`)).status).toBe(404)
    await expect(api.send(id, 'bypass', [stored.id])).rejects.toThrow()

    owner(db.workspace, [db.product + 1000])
    expect((await post(id, png(PNG.length + 4), { 'Content-Type': 'image/png' })).status).toBe(404)
    expect((await routed(`/api/conversations/${id}/files/${stored.id}`)).status).toBe(404)
    owner(db.otherWorkspace, [db.product])
    expect((await routed(`/api/conversations/${id}/files/${stored.id}`)).status).toBe(404)
  })
})
