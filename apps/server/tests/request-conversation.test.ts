import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

type Doc = Record<string, any>
type User = Doc & { id: number }
let payload: Payload
let testDb: TestDb
let conv: typeof import('../src/lib/request-conversation')
let ws: number
let web: number
let api: number
let alice: User
let owner: User
let ownerOfApi: User
let outsider: User
let otherWs: number
const o = { overrideAccess: true, depth: 0 } as const
const who = (user: User, workspace = ws) => ({ payload, user, workspace })

beforeAll(async () => {
  testDb = await createTestDb('request_conversation')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.INTAKE_FAKE = '1'
  process.env.MEDIA_DIR = `/tmp/bauherr-request-conversation-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  conv = await import('../src/lib/request-conversation')
  await import('../src/lib/fake-forge')
  ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme' }, ...o })).id as number
  otherWs = (await payload.create({ collection: 'workspaces', data: { name: 'other', slug: 'other' }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  web = (await payload.create({ collection: 'products', data: { name: 'Web', slug: 'web', workspace: ws }, ...o })).id as number
  api = (await payload.create({ collection: 'products', data: { name: 'Api', slug: 'api', workspace: ws }, ...o })).id as number
  for (const [repo, product] of [['acme/web', web], ['acme/api', api]] as const) await payload.create({ collection: 'ticket_sources', data: { repo, product, connection, workspace: ws }, ...o })
  alice = (await payload.create({ collection: 'bauherren', data: { email: 'alice@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o })) as User
  owner = (await payload.create({ collection: 'bauherren', data: { email: 'owner@x.io', password: 'pw-123456', role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [web] }] } as never, ...o })) as User
  ownerOfApi = (await payload.create({ collection: 'bauherren', data: { email: 'api@x.io', password: 'pw-123456', role: 'product-owner', assignments: [{ workspace: ws, scope: 'products', products: [api] }] } as never, ...o })) as User
  outsider = (await payload.create({ collection: 'bauherren', data: { email: 'out@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: otherWs }] }, ...o })) as User
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const draftOf = async (user: User) => (await conv.startDraft(who(user)))!

describe('starting a draft', () => {
  it('reuses the empty draft the person left, and starts a new one only after they wrote to it', async () => {
    const first = await draftOf(alice)
    expect(await draftOf(alice)).toBe(first)
    expect(await payload.count({ collection: 'intake_sessions', where: { user: { equals: alice.id } }, ...o })).toMatchObject({ totalDocs: 1 })
    await conv.requestTurn(who(alice), { session: first, text: 'The export button does nothing' })
    expect(await draftOf(alice)).not.toBe(first)
  })

  it('takes the chosen Product while nothing was said, and only one the person may see', async () => {
    const s = await draftOf(alice)
    expect(await conv.startDraft(who(alice), api)).toBe(s)
    expect(((await payload.findByID({ collection: 'intake_sessions', id: s, ...o })) as Doc).product).toBe(api)
    expect(await conv.startDraft(who(alice), 99999999)).toBe(s) // an unknown Product: the first of theirs, no new draft
    const po = await draftOf(owner)
    expect(await conv.startDraft(who(owner), api)).toBe(po)
    expect(((await payload.findByID({ collection: 'intake_sessions', id: po, ...o })) as Doc).product).toBe(web) // not assigned: stays Web
  })

  it('has nothing for a person without a Product in the Workspace', async () => {
    expect(await conv.startDraft(who(outsider, otherWs))).toBeNull()
  })
})

describe('a turn', () => {
  it('stores the exchange with its time and usage, fills the card, marks what changed, and offers the answers', async () => {
    const id = await draftOf(alice)
    const seen: string[] = []
    const view = await conv.requestTurn(who(alice), { session: id, text: 'The export button does nothing on the invoices page', onPartial: (json) => seen.push(json) })
    expect(seen.length).toBeGreaterThan(1) // streamed in pieces
    expect(view.messages.map((m) => [m.role, m.text])).toEqual([['user', 'The export button does nothing on the invoices page'], ['assistant', 'Who is affected, and since when?']])
    expect(view.messages[1]).toMatchObject({ speaker: { role: 'Factory assistant', model: expect.stringContaining('claude') }, usage: { tokensIn: 10 } })
    expect(view.options).toEqual([{ label: 'Everyone, since last week', recommended: true }, { label: 'Only some accounts', recommended: false }])
    expect(view.card).toMatchObject({ kind: 'bug', title: 'The export button does nothing on the invoices page', changed: expect.arrayContaining(['title', 'problem', 'type']), needs: expect.arrayContaining(['acceptance_criteria']), canSend: false })
    expect(view.cost.turns).toHaveLength(1)
    expect(view.tier).toBe('standard')
    const next = await conv.requestTurn(who(alice), { session: id, text: 'Everyone, since last week' })
    expect(next.card.changed).toEqual(['context']) // only what this turn changed
    expect(next.options).toEqual([])
  })

  it('adopts the uploaded screenshots into the draft and shows them on the card, in the message and as a removable attachment', async () => {
    const id = await draftOf(alice)
    const { saveMedia } = await import('../src/lib/intake/media')
    const m = await saveMedia(payload, { bytes: png, name: 'shot.png', workspace: ws })
    const view = await conv.requestTurn(who(alice), { session: id, text: 'The save page shows an error', images: [m.id as number] })
    expect(view.card.images).toMatchObject([{ id: m.id, name: 'shot.png' }])
    expect(view.messages[0]).toMatchObject({ images: [{ id: m.id }] })
    expect(view.card.needs).not.toContain('screenshot')
    const gone = await conv.requestEdit(who(alice), id, { removeImage: m.id as number })
    expect(gone.card.images).toEqual([])
    await expect(conv.requestTurn(who(alice), { session: (await draftOf(alice)), text: 'again', images: [m.id as number] })).rejects.toThrow() // deleted with the card's removal
  })

  it('stores nothing when it is aborted', async () => {
    const id = await draftOf(alice)
    const ctl = new AbortController()
    ctl.abort()
    await expect(conv.requestTurn(who(alice), { session: id, text: 'Something', signal: ctl.signal })).rejects.toThrow()
    expect(((await payload.findByID({ collection: 'intake_sessions', id, ...o })) as Doc).messages).toEqual([])
  })

  it('belongs to its author: another person, another Product owner and another Workspace find nothing', async () => {
    const id = await draftOf(owner)
    expect(await conv.ownsRequest(who(owner), id)).toBe(true)
    for (const [user, workspace] of [[alice, ws], [ownerOfApi, ws], [outsider, otherWs]] as const) {
      expect(await conv.loadRequestView(who(user, workspace), id), user.email).toBeNull()
      expect(await conv.ownsRequest(who(user, workspace), id)).toBe(false)
      await expect(conv.requestTurn(who(user, workspace), { session: id, text: 'x' })).rejects.toThrow('not found')
      await expect(conv.requestEdit(who(user, workspace), id, { patch: { title: 'x' } })).rejects.toThrow('not found')
    }
  })
})

describe('filing', () => {
  const finish = async (user: User, first: string) => {
    const id = await draftOf(user)
    for (const t of [first, 'Finance, last week', 'Totals should match']) await conv.requestTurn(who(user), { session: id, text: t })
    return id
  }

  it('files the card as it stands, keeps the conversation as read-only history with its handoff, and refuses another turn', async () => {
    const id = await finish(owner, 'The invoice total is wrong')
    const ready = (await conv.loadRequestView(who(owner), id))!
    expect(ready).toMatchObject({ status: 'Ready to file.', next: expect.stringMatching(/^Then: /) })
    const view = await conv.requestFile(who(owner), id)
    expect(view).toMatchObject({ sent: true, handoff: { numbers: [expect.any(Number)] }, status: expect.stringMatching(/^Filed as #\d+\.$/), card: { editable: false, sent: true } })
    expect(view.messages).toHaveLength(6)
    await expect(conv.requestTurn(who(owner), { session: id, text: 'one more thing' })).rejects.toThrow('already filed')
    await expect(conv.requestEdit(who(owner), id, { patch: { title: 'x' } })).rejects.toThrow('cannot be edited')
    expect((await conv.loadRequestView(who(owner), id))!.handoff).toMatchObject({ ticket: null }) // the Ticket row appears when the factory has synced the issue
    const number = view.handoff!.numbers[0]!
    const t = await payload.create({ collection: 'tickets', data: { title: 'x', externalId: `rc-${number}`, number, url: `https://x/${number}`, state: 'open', labels: [], stage: 'triage', product: web, workspace: ws }, ...o } as never)
    expect((await conv.loadRequestView(who(owner), id))!.handoff).toMatchObject({ ticket: { id: t.id, number } })
  })

  it('refuses an incomplete card with what is missing, and a hand edit completes it', async () => {
    const id = await draftOf(alice)
    await conv.requestTurn(who(alice), { session: id, text: 'The invoice total is wrong' })
    await expect(conv.requestFile(who(alice), id)).rejects.toThrow('draft incomplete')
    const view = await conv.requestEdit(who(alice), id, { patch: { acceptance_criteria: ['Totals match'], context: 'Invoices page' } })
    expect(view.card).toMatchObject({ canSend: true, criteria: ['Totals match'] })
    expect((await conv.requestFile(who(alice), id)).sent).toBe(true)
  })
})

describe('empty drafts', () => {
  it('are deleted once they are old enough, and a draft with a message never', async () => {
    const empty = await draftOf(ownerOfApi)
    const written = await draftOf(alice)
    await conv.requestTurn(who(alice), { session: written, text: 'Something is off' })
    expect(await conv.pruneEmptyRequests(payload)).toBe(0) // too recent
    expect(await conv.pruneEmptyRequests(payload, { olderThanMs: 0 })).toBeGreaterThanOrEqual(1)
    expect(await payload.count({ collection: 'intake_sessions', where: { id: { equals: empty } }, ...o })).toMatchObject({ totalDocs: 0 })
    expect(await payload.count({ collection: 'intake_sessions', where: { id: { equals: written } }, ...o })).toMatchObject({ totalDocs: 1 })
  })
})
