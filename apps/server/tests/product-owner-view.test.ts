import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

/**
 * What a Product owner sees (people slice 2): everything is filtered by the assignment in `lib/people.ts`, and what is not theirs answers as if it did not exist.
 * Workspace a has products a1 (assigned) and a2; Workspace b has b1.
 */
const session = vi.hoisted(() => ({ cookie: '' }))
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: session.cookie }), cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const o = { overrideAccess: true, depth: 0 } as const
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const PASSWORD = 'pw-123456-view'

let payload: Payload
let testDb: TestDb
let ws: { a: number; b: number }
let product: { a1: number; a2: number; b1: number }
let ticket: { a1: number; a2: number; b1: number }
let po: Record<string, any>
let other: Record<string, any>
let bauherr: Record<string, any>
let cookie: { po: string; bauherr: string }
let request: Record<string, number>
let image: Record<string, number>
let artifact: { a1: number; a2: number }

const asUser = async (c: string) => (await payload.auth({ headers: new Headers({ cookie: c }) })).user as Record<string, any>

beforeAll(async () => {
  testDb = await createTestDb('po_view')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.MEDIA_DIR = `/tmp/bauherr-po-view-${process.pid}`
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const { signSession } = await import('../src/lib/oidc-session')
  const { saveMedia } = await import('../src/lib/intake/media')
  await payload.create({ collection: 'bauherren', data: { email: 'admin@x.io', password: PASSWORD, role: 'admin' }, ...o })
  const [a, b] = await Promise.all(['a', 'b'].map(async (slug) => (await payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })).id as number))
  ws = { a, b }
  const mkProduct = async (slug: string, workspace: number) => (await payload.create({ collection: 'products', data: { name: slug, slug, workspace }, ...o })).id as number
  product = { a1: await mkProduct('a1', a), a2: await mkProduct('a2', a), b1: await mkProduct('b1', b) }
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: a }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product: product.a1, connection, workspace: a }, ...o })
  const mkTicket = async (n: number, workspace: number, p: number) => (await payload.create({ collection: 'tickets', data: { title: `Ticket ${n}`, externalId: `v${n}`, number: n, url: `https://x/${n}`, state: 'open', labels: [], stage: 'plan', product: p, workspace }, ...o })).id as number
  ticket = { a1: await mkTicket(1, a, product.a1), a2: await mkTicket(2, a, product.a2), b1: await mkTicket(3, b, product.b1) }
  const user = (email: string, data: Record<string, unknown>) => payload.create({ collection: 'bauherren', data: { email, password: PASSWORD, ...data } as never, ...o })
  const mkPo = await user('owner@x.io', { role: 'product-owner', assignments: [{ workspace: a, scope: 'products', products: [product.a1] }] })
  const mkOther = await user('colleague@x.io', { role: 'product-owner', assignments: [{ workspace: a, scope: 'workspace' }] })
  const mkBauherr = await user('member@x.io', { role: 'bauherr', tenants: [{ tenant: a }] })
  cookie = { po: `bauherr-session=${signSession(mkPo.id, 0)}`, bauherr: `bauherr-session=${signSession(mkBauherr.id, 0)}` }
  ;[po, bauherr] = await Promise.all([asUser(cookie.po), asUser(cookie.bauherr)])
  other = (await payload.findByID({ collection: 'bauherren', id: mkOther.id, depth: 1, overrideAccess: true })) as Record<string, any>
  const draft = { problem: 'It breaks', context: 'Everywhere', acceptance_criteria: ['It works'], type: 'bug', links: [] }
  const mkSession = async (key: string, data: Record<string, unknown>) => (request[key] = (await payload.create({ collection: 'intake_sessions', data: { persona: 'product-user', messages: [], draft, ...data } as never, ...o })).id as number)
  request = {}
  await mkSession('sentA1', { product: product.a1, workspace: a, status: 'submitted', ticketNumber: 1, user: other.id, title: 'Sent for A1' })
  await mkSession('sentA2', { product: product.a2, workspace: a, status: 'submitted', ticketNumber: 2, user: other.id, title: 'Sent for A2' })
  await mkSession('sentB1', { product: product.b1, workspace: b, status: 'submitted', ticketNumber: 3, user: other.id, title: 'Sent for B1' })
  await mkSession('draftMine', { product: product.a1, workspace: a, status: 'open', user: po.id, title: 'My draft' })
  await mkSession('draftOther', { product: product.a1, workspace: a, status: 'open', user: other.id, title: 'Their draft' })
  const file = (name: string, extra: Record<string, unknown>) => saveMedia(payload, { bytes: png, name, workspace: a, ...extra } as never).then((m) => m.id as number)
  image = {
    commentA1: await file('c1.png', { product: product.a1, ticketNumber: 1 }),
    commentA2: await file('c2.png', { product: product.a2, ticketNumber: 2 }),
    shotSentA1: await file('s1.png', { session: request.sentA1 }),
    shotDraftOther: await file('s2.png', { session: request.draftOther }),
    shotDraftMine: await file('s3.png', { session: request.draftMine }),
    shotSentA2: await file('s4.png', { session: request.sentA2 }),
  }
  const mkArtifact = async (t: number) => (await payload.create({ collection: 'artifacts', data: { ticket: t, workspace: a, kind: 'report', title: 'Report', text: 'All green', sha: 'abc' }, ...o })).id as number
  artifact = { a1: await mkArtifact(ticket.a1), a2: await mkArtifact(ticket.a2) }
  session.cookie = cookie.po
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

describe('Requests of a Product owner', () => {
  it('the workbench lists the sent requests of assigned Products only, with no By column, and offers only assigned Products', async () => {
    const { loadWorkbench } = await import('../src/app/(app)/lib/requests')
    const wb = await loadWorkbench(ws.a, po)
    expect([...wb.needs, ...wb.factory, ...wb.done].map((r) => r.id)).toEqual([request.sentA1])
    expect(wb.products.map((p) => p.name)).toEqual(['a1'])
    expect(wb.showBy).toBe(false)
    expect((await loadWorkbench(ws.b, po)).factory).toEqual([])
    expect([...(await loadWorkbench(ws.a, other)).factory].map((r) => r.id).sort()).toEqual([request.sentA1, request.sentA2].sort())
    expect([...(await loadWorkbench(ws.a, bauherr)).factory].length).toBe(2)
  })

  it('a Bauherr need is never "Needs you" for a Product owner', async () => {
    await payload.update({ collection: 'tickets', id: ticket.a1, data: { needsYou: 'Approve plan' }, ...o })
    const { loadWorkbench } = await import('../src/app/(app)/lib/requests')
    expect((await loadWorkbench(ws.a, po)).needs).toEqual([])
    expect((await loadWorkbench(ws.a, po)).factory.map((r) => r.id)).toEqual([request.sentA1])
    await payload.update({ collection: 'tickets', id: ticket.a1, data: { needsYou: null }, ...o })
  })

  it('drafts are their own, and only of assigned Products', async () => {
    const { loadDrafts } = await import('../src/app/(app)/lib/requests')
    expect((await loadDrafts(po as never, ws.a)).map((d) => d.id)).toEqual([request.draftMine])
    expect((await loadDrafts(other as never, ws.a)).map((d) => d.id)).toEqual([request.draftOther])
  })

  it('a request page exists for an assigned Product and their own draft, never for Product B, another Workspace or a colleague\'s draft', async () => {
    const { loadRequest } = await import('../src/app/(app)/lib/requests')
    const get = (key: string, workspace = ws.a) => loadRequest(workspace, request[key]!, po as never)
    expect((await get('sentA1'))?.title).toBe('Sent for A1')
    expect((await get('draftMine'))?.own).toBe(true)
    for (const key of ['sentA2', 'draftOther']) expect(await get(key), key).toBeNull()
    expect(await get('sentB1', ws.b)).toBeNull()
    expect(await get('sentA1', ws.b)).toBeNull()
  })

  it('the Ticket page is for an assigned Product only: the same answer for another Product, another Workspace and a missing Ticket', async () => {
    const { loadOwnerTicket } = await import('../src/app/(app)/lib/requests')
    const view = await loadOwnerTicket(ws.a, ticket.a1, po as never)
    expect(view).toMatchObject({ ticket: { number: 1, title: 'Ticket 1' }, product: { name: 'a1' }, request: request.sentA1 })
    expect(JSON.stringify(view)).not.toMatch(/runs|costUsd|tokens|executor/i)
    expect(await loadOwnerTicket(ws.a, ticket.a2, po as never)).toBeNull()
    expect(await loadOwnerTicket(ws.b, ticket.b1, po as never)).toBeNull()
    expect(await loadOwnerTicket(ws.a, ticket.b1, po as never)).toBeNull()
    expect(await loadOwnerTicket(ws.a, 999_999, po as never)).toBeNull()
    expect(await loadOwnerTicket(ws.a, ticket.a2, other as never)).not.toBeNull()
  })

  it('the pages: Requests, a request and the Ticket render for a Product owner and are 404 for Product B; New request opens their own draft', async () => {
    session.cookie = cookie.po
    const notFound = (e: unknown) => /404|NEXT_NOT_FOUND/.test(String((e as { digest?: string })?.digest ?? e))
    const render = async (load: () => Promise<{ default: (p: any) => Promise<unknown> }>, params: Record<string, string>) => {
      try {
        await (await load()).default({ params: Promise.resolve(params), searchParams: Promise.resolve({}) })
        return 'rendered'
      } catch (e) {
        return notFound(e) ? '404' : `threw ${String(e)}`
      }
    }
    const requestPage = () => import('../src/app/(app)/(shell)/requests/[id]/page')
    const ticketPage = () => import('../src/app/(app)/(shell)/tickets/[id]/page')
    expect(await render(() => import('../src/app/(app)/(shell)/requests/page'), {})).toBe('rendered')
    expect(await render(() => import('../src/app/(app)/(shell)/requests/new/page'), {})).toBe('threw Error: NEXT_REDIRECT') // to the conversation on their empty draft
    expect(await render(requestPage, { id: String(request.sentA1) })).toBe('rendered')
    expect(await render(requestPage, { id: String(request.sentA2) })).toBe('404')
    expect(await render(requestPage, { id: String(request.draftOther) })).toBe('404')
    expect(await render(ticketPage, { id: String(ticket.a1) })).toBe('rendered')
    expect(await render(ticketPage, { id: String(ticket.a2) })).toBe('404')
    expect(await render(ticketPage, { id: String(ticket.b1) })).toBe('404')
    session.cookie = cookie.bauherr
    expect(await render(ticketPage, { id: String(ticket.a2) })).toBe('rendered')
    session.cookie = cookie.po
  })
})

describe('what a Product owner does not get', () => {
  it('an urgent request of a Product owner proposes the fast lane, never sets it', async () => {
    const { canPutOnFastLane } = await import('../src/lib/expedite')
    expect([po, other, bauherr, { role: 'admin' }].map(canPutOnFastLane)).toEqual([false, false, false, true])
  })

  it('the card is read-only with images through the signed-in route', async () => {
    const { loadRequest } = await import('../src/app/(app)/lib/requests')
    const card = (await loadRequest(ws.a, request.draftMine!, po as never))!.card
    expect(card.editable).toBe(false)
    expect(card.productChoices).toEqual([])
    expect(card.images.map((i) => i.url)).toEqual([`/intake/api/media/${image.shotDraftMine}`])
  })

  it('the dock is closed: the chat routes refuse a Product owner', async () => {
    const { GET } = await import('../src/app/api/chat/threads/route')
    const res = await GET(new Request('http://t/api/chat/threads', { headers: { cookie: cookie.po } }))
    expect(res.status).toBe(403)
  })
})

describe('files', () => {
  const get = async (route: string, params: Record<string, string>, as: string) => {
    const mod = await import(route)
    return (mod.GET as (r: Request, c: unknown) => Promise<Response>)(new Request('http://t/x', { headers: { cookie: as } }), { params: Promise.resolve(params) })
  }

  it('media of an assigned Product is served to a Product owner through the signed-in route; Product B, other drafts and unattached files are 404', async () => {
    const route = '../src/app/intake/api/media/[id]/route'
    const status = async (key: string, as = cookie.po) => (await get(route, { id: String(image[key]) }, as)).status
    expect(await status('commentA1')).toBe(200)
    expect(await status('shotSentA1')).toBe(200)
    expect(await status('shotDraftMine')).toBe(200)
    for (const key of ['commentA2', 'shotDraftOther', 'shotSentA2']) expect(await status(key), key).toBe(404)
    expect(await status('commentA2', cookie.bauherr)).toBe(200)
    expect((await get(route, { id: String(image.commentA1) }, '')).status).toBe(401)
    expect((await get(route, { id: '999999' }, cookie.po)).status).toBe(404)
  })

  it('a review artifact is served to a Product owner of its Product only, never through a public link', async () => {
    const route = '../src/app/api/tickets/[id]/artifacts/[artifactId]/route'
    expect((await get(route, { id: String(ticket.a1), artifactId: String(artifact.a1) }, cookie.po)).status).toBe(200)
    expect((await get(route, { id: String(ticket.a2), artifactId: String(artifact.a2) }, cookie.po)).status).toBe(404)
    expect((await get(route, { id: String(ticket.a1), artifactId: String(artifact.a2) }, cookie.po)).status).toBe(404)
    expect((await get(route, { id: String(ticket.a2), artifactId: String(artifact.a2) }, cookie.bauherr)).status).toBe(200)
    expect((await get(route, { id: String(ticket.a1), artifactId: String(artifact.a1) }, '')).status).toBe(401)
  })

  it('comment images are rewritten to the signed-in route for a Product owner; the factory\'s own comments are dropped', async () => {
    const { forOwner } = await import('../src/app/(app)/lib/comments')
    expect(forOwner('![shot.png](https://bauherr.example.com/m/12/abc_-9.png)\n\ntext')).toBe('![shot.png](/intake/api/media/12)\n\ntext')
    expect(forOwner('<!-- bauherr:worklog -->\n...')).toBeNull()
    expect(forOwner('Bauherr needs a human: the review found 1 issue')).toBeNull()
    expect(forOwner('plain')).toBe('plain')
  })
})
