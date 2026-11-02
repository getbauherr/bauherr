import pg from 'pg'
import type { FakeBackend } from '@bauherr/adapters'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { nextTurn, type Draft, type ModelCall } from '../src/lib/intake/engine'
import { sniff, stripMetadata } from '../src/lib/intake/media'

let payload: Payload
let fake: FakeBackend
let actions: typeof import('../src/lib/actions')
let sessions: typeof import('../src/app/intake/api/sessions/route')
let messages: typeof import('../src/app/intake/api/sessions/[id]/messages/route')
let submit: typeof import('../src/app/intake/api/sessions/[id]/submit/route')
let media: typeof import('../src/app/intake/api/media/[id]/route')
let shots: typeof import('../src/app/intake/api/sessions/[id]/screenshots/route')
let productId: number
let keyA: string
let keyB: string
let keyA2: string
const o = { overrideAccess: true } as const
const repo = 'acme/web'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_intake_shots WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_intake_shots')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_intake_shots')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_URL = 'http://gateway.test'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  actions = await import('../src/lib/actions')
  media = await import('../src/app/intake/api/media/[id]/route')
  shots = await import('../src/app/intake/api/sessions/[id]/screenshots/route')
  sessions = await import('../src/app/intake/api/sessions/route')
  messages = await import('../src/app/intake/api/sessions/[id]/messages/route')
  submit = await import('../src/app/intake/api/sessions/[id]/submit/route')
  fake = (await import('../src/lib/fake-forge')).fakeForge()
  const [wsA, wsB] = await Promise.all(['acme', 'other'].map(async (slug) => (await payload.create({ collection: 'workspaces', data: { name: slug, slug, defaultMode: 'session' }, ...o })).id as number))
  productId = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: wsA }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: wsA }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo, product: productId, connection, workspace: wsA }, ...o })
  const { rotateApiKey } = await import('../src/lib/api-key')
  const mk = async (email: string, tenant: number) => rotateApiKey(payload, await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr', tenants: [{ tenant }] }, ...o }))
  keyA = await mk('a@x.io', wsA)
  keyB = await mk('b@x.io', wsB)
  keyA2 = await mk('a2@x.io', wsA)
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await payload?.destroy()
})


const draft = (p: Partial<Draft> = {}): Draft => ({ problem: 'Save button does nothing', context: 'Settings page', acceptance_criteria: ['Saves', 'Shows a toast'], type: 'bug', links: [], ...p })
const turn = (extra: object = {}) => ({ question: 'Next?', draft: draft(), needsScreenshot: false, missing: [], ...extra })
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })
const json = (key: string, body: unknown) => new Request('http://x.test/i', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `bauherren API-Key ${key}` }, body: JSON.stringify(body) })
const auth = (key: string) => new Request('http://x.test/i', { headers: { authorization: `bauherren API-Key ${key}` } })
const upload = async (key: string, bytes: Uint8Array | ArrayBuffer, name = 'shot.png') => {
  const form = new FormData()
  form.set('file', new File([bytes as BlobPart], name))
  const wire = new Response(form)
  const body = await wire.arrayBuffer()
  return new Request('http://x.test/i', { method: 'POST', headers: { authorization: `bauherren API-Key ${key}`, 'content-type': wire.headers.get('content-type')!, 'content-length': String(body.byteLength) }, body })
}
const withLength = (r: Request, n: number) => new Request(r, { headers: { ...Object.fromEntries((r.headers as any).entries()), 'content-length': String(n) }, body: r.body, duplex: 'half' } as RequestInit)

const bytes = (...p: (number[] | Uint8Array | string)[]) => Uint8Array.from(p.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [...x])))
const be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const chunk = (type: string, data: string) => bytes(be(data.length), type, data, [0, 0, 0, 0])
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const png = (...extra: Uint8Array[]) => bytes(PNG_SIG, chunk('IHDR', '1234567890123'), ...extra, chunk('IDAT', 'x'), chunk('IEND', ''))
const text = (b: Uint8Array) => Buffer.from(b).toString('latin1')

const newSession = async (key = keyA) => (await (await sessions.POST(json(key, { product: productId }))).json()).id as number

it('sniffs by magic bytes and strips EXIF/text metadata from png, jpeg and webp', () => {
  expect(sniff(bytes('GIF89a'))).toBeNull()
  expect(sniff(bytes('<svg'))).toBeNull()
  const p = stripMetadata(png(chunk('tEXt', 'GPS=51.1,7.2'), chunk('eXIf', 'MM-secret')), 'image/png')
  expect(sniff(p)).toBe('image/png')
  expect(text(p)).not.toMatch(/GPS|secret|tEXt|eXIf/)
  expect(text(p)).toContain('IDAT')

  const jpg = bytes([0xff, 0xd8], [0xff, 0xe0, 0, 4, 1, 1], [0xff, 0xe1, 0, 8, ...[...'Exif!!'].map((c) => c.charCodeAt(0))], [0xff, 0xda, 0, 2, 9, 9, 0xff, 0xd9])
  const j = stripMetadata(jpg, 'image/jpeg')
  expect(text(j)).not.toContain('Exif')
  expect([...j.slice(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xe0])
  expect([...j.slice(-4)]).toEqual([9, 9, 0xff, 0xd9])

  const vp8x = bytes('VP8X', [10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const exif = bytes('EXIF', [6, 0, 0, 0], 'secret')
  const body = bytes('VP8 ', [2, 0, 0, 0, 1, 2])
  const raw = bytes('RIFF', [0, 0, 0, 0], 'WEBP', vp8x, exif, body)
  new DataView(raw.buffer).setUint32(4, raw.length - 8, true)
  const w = stripMetadata(raw, 'image/webp')
  expect(text(w)).not.toMatch(/EXIF|secret/)
  expect(w[20]! & 0x0c).toBe(0)
  expect(w[20]! & 0x20).toBe(0x20)
  expect(new DataView(w.buffer).getUint32(4, true)).toBe(w.length - 8)
  expect(() => stripMetadata(bytes(PNG_SIG, [0, 0, 9, 9], 'IDAT'), 'image/png')).toThrow('corrupt')
})

it('upload: auth, Workspace isolation, type, size and per-session count are enforced server-side', async () => {
  const id = await newSession()
  expect((await shots.POST(await upload('nope', png()), ctx(id))).status).toBe(401)
  expect((await shots.POST(await upload(keyB, png()), ctx(id))).status).toBe(404)
  expect((await shots.POST(await upload(keyA2, png()), ctx(id))).status).toBe(404)
  expect((await shots.POST(await upload(keyA, bytes('GIF89a....'), 'x.png'), ctx(id))).status).toBe(415)
  expect((await shots.POST(await upload(keyA, bytes('<svg onload=alert(1)>'), 'x.png'), ctx(id))).status).toBe(415)
  expect((await shots.POST(await upload(keyA, new Uint8Array(5 * 1024 * 1024 + 1).fill(1), 'big.png'), ctx(id))).status).toBe(413)
  expect((await shots.POST(withLength(await upload(keyA, png()), 6 * 1024 * 1024), ctx(id))).status).toBe(413)
  expect((await shots.POST(new Request('http://x.test/i', { method: 'POST', headers: { authorization: `bauherren API-Key ${keyA}`, 'content-length': '1' }, body: 'x' }), ctx(id))).status).toBe(400)
  expect((await shots.POST(new Request('http://x.test/i', { method: 'POST', headers: { authorization: `bauherren API-Key ${keyA}` }, body: 'x' }), ctx(id))).status).toBe(411)
  expect((await payload.count({ collection: 'media', where: { session: { equals: id } }, ...o })).totalDocs).toBe(0)

  const ok = await Promise.all(Array.from({ length: 7 }, async () => shots.POST(await upload(keyA, png(chunk('tEXt', 'GPS'))), ctx(id))))
  expect(ok.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 201, 409, 409])
  const stored = (await payload.find({ collection: 'media', where: { session: { equals: id } }, ...o })).docs as any[]
  expect(stored).toHaveLength(5)
  expect(Buffer.from(stored[0].data, 'base64').toString('latin1')).not.toContain('GPS')
  expect((await payload.findByID({ collection: 'intake_sessions', id, depth: 0, ...o }) as any).screenshots).toBe(5)
})

it('media route serves the stored image to Workspace members only, as an inert download type', async () => {
  const id = await newSession()
  const { id: mid } = await (await shots.POST(await upload(keyA, png()), ctx(id))).json()
  expect((await media.GET(auth('nope'), ctx(mid))).status).toBe(401)
  expect((await media.GET(auth(keyB), ctx(mid))).status).toBe(404)
  const r = await media.GET(auth(keyA2), ctx(mid))
  expect(r.status).toBe(200)
  expect(r.headers.get('content-type')).toBe('image/png')
  expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  expect(sniff(new Uint8Array(await r.arrayBuffer()))).toBe('image/png')
})

it('the engine request carries the screenshots as image blocks; foreign or reused ids are refused', async () => {
  const id = await newSession()
  const other = await newSession()
  const { id: m1 } = await (await shots.POST(await upload(keyA, png()), ctx(id))).json()
  const { id: foreign } = await (await shots.POST(await upload(keyA, png()), ctx(other))).json()
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string))
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(turn()) }] })
  })
  const first = await (await messages.POST(json(keyA, { text: 'the save button does nothing', images: [foreign] }), ctx(id))).text()
  expect(first).toMatch(/^event: error/)
  expect(bodies).toHaveLength(0)
  expect(await (await messages.POST(json(keyA, { text: 'the save button does nothing', images: [m1] }), ctx(id))).text()).toMatch(/^event: turn/)
  const content = bodies[0].messages.at(-1).content
  expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
  expect(content[0].source.data).toBe(((await payload.findByID({ collection: 'media', id: m1, depth: 0, ...o })) as any).data)
  expect(content.at(-1)).toEqual({ type: 'text', text: 'the save button does nothing' })
  expect((await messages.POST(json(keyA, { text: 'again', images: [m1] }), ctx(id))).status).toBe(200)
  expect(bodies).toHaveLength(1)
  await (await messages.POST(json(keyA, { text: 'no image' }), ctx(id))).text()
  expect(bodies[1].messages[0].content).toBe('the save button does nothing')
})

it('a screen request cannot be submitted without a screenshot, then lands with the attachment (adapter) or a link (fallback)', async () => {
  const blocked = await newSession()
  vi.stubGlobal('fetch', async () => Response.json({ content: [{ type: 'text', text: JSON.stringify(turn()) }] }))
  await (await messages.POST(json(keyA, { text: 'the save button does nothing' }), ctx(blocked))).text()
  const refused = await submit.POST(json(keyA, {}), ctx(blocked))
  expect(refused.status).toBe(409)
  expect((await refused.json()).error).toContain('screenshot')

  const forge = fake.tickets(repo) as any
  const run = async () => {
    const id = await newSession()
    const { id: m } = await (await shots.POST(await upload(keyA, png(), 'my shot.png'), ctx(id))).json()
    await (await messages.POST(json(keyA, { text: 'the save button does nothing', images: [m] }), ctx(id))).text()
    const { number } = await (await submit.POST(json(keyA, {}), ctx(id))).json()
    expect(((await payload.findByID({ collection: 'media', id: m, depth: 0, ...o })) as any).attached).toBe(true)
    await submit.POST(json(keyA, {}), ctx(id))
    return number as number
  }

  const links = await run()
  const strip = await payload.find({ collection: 'media', where: { and: [{ 'session.product': { equals: productId } }, { 'session.ticketNumber': { equals: links } }, { 'session.status': { equals: 'submitted' } }] }, select: { name: true }, ...o })
  expect(strip.docs.map((m: any) => m.name)).toEqual(['my_shot.png'])
  expect(strip.docs[0]).not.toHaveProperty('data')
  expect((await forge.get(String(links))).links).toEqual([expect.stringMatching(/\/intake\/api\/media\/\d+$/)])

  const calls: unknown[][] = []
  forge.addAttachment = async (...a: unknown[]) => (calls.push(a), 'att-1')
  const number = await run()
  delete forge.addAttachment
  expect(calls).toHaveLength(1)
  expect(calls[0]!.slice(0, 2)).toEqual([String(number), 'my_shot.png'])
  expect((calls[0]![2] as Uint8Array).length).toBeGreaterThan(20)
  expect((await forge.get(String(number))).links).toEqual([])
})
