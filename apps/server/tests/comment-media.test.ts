import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let actions: typeof import('../src/lib/actions')
let media: typeof import('../src/lib/intake/media')
let route: typeof import('../src/app/api/tickets/[id]/media/route')
let admin: any
let member: any
let outsider: any
let memberKey: string
let ticket: number
let other: number
const o = { overrideAccess: true } as const
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('comment_media')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.MEDIA_DIR = `/tmp/bauherr-comment-media-${process.pid}`
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  media = await import('../src/lib/intake/media')
  route = await import('../src/app/api/tickets/[id]/media/route')
  const [ws, ws2] = (await Promise.all(['acme', 'other'].map((slug) => payload.create({ collection: 'workspaces', data: { name: slug, slug }, ...o })))).map((w) => w.id as number) as [number, number]
  const product = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product, connection, workspace: ws }, ...o })
  const mk = (n: number) => payload.create({ collection: 'tickets', data: { title: 't', externalId: `e${n}`, number: n, url: `https://x/${n}`, state: 'open', labels: [], stage: 'plan', product, workspace: ws }, ...o })
  ticket = (await mk(1)).id as number
  other = (await mk(2)).id as number
  const user = (email: string, tenant: number) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant }] }, ...o })
  admin = await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'admin' }, ...o })
  member = await user('m@x.io', ws)
  outsider = await user('o@x.io', ws2)
  memberKey = await (await import('../src/lib/api-key')).rotateApiKey(payload, member)
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const comments = async (n: number) => (await (await actions.sourceOf(payload, await actions.loadTicket(payload, admin, n === 1 ? ticket : other))).ts.listComments(String(n))).map((c) => c.body)
const upload = (id: number | string, key: string, body: Buffer = png) => {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(body)], 'shot.png', { type: 'image/png' }))
  return route.POST(new Request('http://x/api', { method: 'POST', body: form, headers: { authorization: `bauherren API-Key ${key}`, 'content-length': String(body.length + 200) } }), { params: Promise.resolve({ id: String(id) }) })
}

it('uploads for a Ticket, posts the comment with the image link, then refuses the same image again', async () => {
  const { id } = await actions.uploadCommentMedia(payload, member, { ticket, name: 'shot.png', bytes: png })
  const doc = await payload.findByID({ collection: 'media', id, ...o })
  expect(doc).toMatchObject({ ticketNumber: 1, attached: false })
  const [url] = await actions.postComment(payload, member, { ticket, body: 'Looks off', mediaIds: [id] })
  expect(url).toMatch(new RegExp(`/m/${id}/[\\w-]+\\.png$`))
  expect((await comments(1)).at(-1)).toBe(`Looks off\n\n![shot.png](${url})`)
  expect(await payload.findByID({ collection: 'media', id, ...o })).toMatchObject({ attached: true })
  await expect(actions.postComment(payload, member, { ticket, body: 'again', mediaIds: [id] })).rejects.toThrow('missing or already posted')
})

it('keeps the image unposted when the forge refuses the comment', async () => {
  const t = await payload.findByID({ collection: 'tickets', id: ticket, ...o })
  const ghost = (await payload.create({ collection: 'tickets', data: { title: 'g', externalId: 'e99', number: 99, url: 'https://x/99', state: 'open', labels: [], stage: 'plan', product: t.product as number, workspace: t.workspace as number }, ...o })).id as number
  const { id } = await actions.uploadCommentMedia(payload, member, { ticket: ghost, name: 'b.png', bytes: png })
  await expect(actions.postComment(payload, member, { ticket: ghost, body: 'x', mediaIds: [id] })).rejects.toThrow()
  expect(await payload.findByID({ collection: 'media', id, ...o })).toMatchObject({ attached: false })
})

it('refuses an empty comment, another Ticket\'s image and a Ticket of another Workspace', async () => {
  await expect(actions.postComment(payload, member, { ticket, body: ' ', mediaIds: [] })).rejects.toThrow('write a comment')
  const { id } = await actions.uploadCommentMedia(payload, member, { ticket, name: 'c.png', bytes: png })
  await expect(actions.postComment(payload, member, { ticket: other, body: 'x', mediaIds: [id] })).rejects.toThrow('missing or already posted')
  await expect(actions.postComment(payload, outsider, { ticket, body: 'x', mediaIds: [id] })).rejects.toThrow()
  await expect(actions.uploadCommentMedia(payload, outsider, { ticket, name: 'c.png', bytes: png })).rejects.toThrow()
})

it('the upload route answers 201, then 415 for a non-image, 401 unauthenticated, 404 for another Workspace', async () => {
  expect((await upload(ticket, memberKey)).status).toBe(201)
  expect((await upload(ticket, memberKey, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status).toBe(415)
  expect((await upload(ticket, 'bad')).status).toBe(401)
  const out = await (await import('../src/lib/api-key')).rotateApiKey(payload, outsider)
  expect((await upload(ticket, out)).status).toBe(404)
})

it('caps unposted images per Ticket and prunes stale ones after 24 h', async () => {
  process.env.MEDIA_MAX_PER_SESSION = '2'
  const unposted = (await payload.count({ collection: 'media', where: { and: [{ ticketNumber: { equals: 1 } }, { attached: { equals: false } }] }, ...o })).totalDocs
  await actions.uploadCommentMedia(payload, member, { ticket, name: 'd.png', bytes: png }).catch(() => undefined)
  await expect(actions.uploadCommentMedia(payload, member, { ticket, name: 'e.png', bytes: png })).rejects.toThrow('at most 2 unposted')
  delete process.env.MEDIA_MAX_PER_SESSION
  expect(unposted).toBeGreaterThan(0)
  const old = await payload.create({ collection: 'media', data: { name: 'old.png', mime: 'image/png', ticketNumber: 1, workspace: (await payload.findByID({ collection: 'tickets', id: ticket, ...o })).workspace as number }, file: { data: png, name: 'old.png', mimetype: 'image/png', size: png.length }, ...o })
  await payload.db.drizzle.execute((await import('@payloadcms/db-postgres')).sql`UPDATE "media" SET "created_at" = now() - interval '25 hours' WHERE "id" = ${old.id}`)
  expect(await media.pruneCommentMedia(payload)).toBe(1)
  expect((await payload.count({ collection: 'media', where: { id: { equals: old.id } }, ...o })).totalDocs).toBe(0)
})
