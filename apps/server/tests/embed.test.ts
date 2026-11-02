import pg from 'pg'
import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

let payload: Payload
let sessions: typeof import('../src/app/intake/api/sessions/route')
let messages: typeof import('../src/app/intake/api/sessions/[id]/messages/route')
let submit: typeof import('../src/app/intake/api/sessions/[id]/submit/route')
let widgetRoute: typeof import('../src/app/intake/widget.js/route')
let embed: typeof import('../src/lib/intake/embed')
let productId: number
let otherProductId: number
let token: string
let keyA: string
const o = { overrideAccess: true } as const
const ORIGIN = 'https://shop.example.com'

beforeAll(async () => {
  const base = process.env.DATABASE_URL ?? 'postgres://bauherr:bauherr@127.0.0.1:54330/bauherr'
  const admin = new pg.Client({ connectionString: base })
  await admin.connect()
  await admin.query('DROP DATABASE IF EXISTS bauherr_test_embed_149 WITH (FORCE)')
  await admin.query('CREATE DATABASE bauherr_test_embed_149')
  await admin.end()
  process.env.DATABASE_URL = base.replace(/\/[^/]+$/, '/bauherr_test_embed_149')
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.BAUHERR_E2E_FAKE_FORGE = '1'
  process.env.GATEWAY_URL = 'http://gateway.test'
  delete process.env.GATEWAY_ADMIN_URL
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  sessions = await import('../src/app/intake/api/sessions/route')
  messages = await import('../src/app/intake/api/sessions/[id]/messages/route')
  submit = await import('../src/app/intake/api/sessions/[id]/submit/route')
  widgetRoute = await import('../src/app/intake/widget.js/route')
  embed = await import('../src/lib/intake/embed')
  const ws = (await payload.create({ collection: 'workspaces', data: { name: 'acme', slug: 'acme', defaultMode: 'session' }, ...o })).id as number
  productId = (await payload.create({ collection: 'products', data: { name: 'web', slug: 'web', workspace: ws }, ...o })).id as number
  otherProductId = (await payload.create({ collection: 'products', data: { name: 'app', slug: 'app', workspace: ws }, ...o })).id as number
  const connection = (await payload.create({ collection: 'connections', data: { name: 'gh', kind: 'github', workspace: ws }, ...o })).id as number
  await payload.create({ collection: 'ticket_sources', data: { repo: 'acme/web', product: productId, connection, workspace: ws }, ...o })
  const { rotateApiKey } = await import('../src/lib/api-key')
  keyA = await rotateApiKey(payload, await payload.create({ collection: 'bauherren', data: { email: 'a@x.io', password: 'pw-123456', role: 'bauherr', tenants: [{ tenant: ws }] }, ...o }))
  token = await embed.createEmbedToken(payload, { product: productId, name: 'shop', allowedOrigins: [`${ORIGIN}/some/path`] })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await payload?.destroy()
})

const call = (auth: string | null, origin: string | null, body: unknown = {}) =>
  new Request('http://x.test/intake', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth && { authorization: auth }), ...(origin && { origin }) }, body: JSON.stringify(body) })
const bearer = (t = token) => `Bearer ${t}`
const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) })
const draft = { problem: 'Export fails', context: 'Invoices page', acceptance_criteria: ['CSV downloads', 'Totals match'], type: 'bug', links: [] }
const stubGateway = () =>
  vi.stubGlobal('fetch', async () => Response.json({ content: [{ type: 'text', text: JSON.stringify({ question: 'Anything else?', draft, needsScreenshot: false, missing: [] }) }] }))

it('stores only the hash of the token, with the origin normalised', async () => {
  const t = (await payload.find({ collection: 'embed_tokens', limit: 1, ...o })).docs[0] as Record<string, any>
  expect(t.tokenHash).toBe(embed.hashToken(token))
  expect(JSON.stringify(t)).not.toContain(token)
  expect(t.allowedOrigins).toEqual([ORIGIN])
})

it('runs the interview from an allowed origin, bound to the token Product, with CORS for that origin only', async () => {
  const r = await sessions.POST(call(bearer(), ORIGIN, { product: otherProductId }))
  expect(r.status).toBe(201)
  expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  const { id } = await r.json()
  const s = (await payload.findByID({ collection: 'intake_sessions', id, depth: 0, ...o })) as Record<string, any>
  expect(s).toMatchObject({ product: productId, status: 'open' })
  expect(s.user).toBeFalsy()
  stubGateway()
  const m = await messages.POST(call(bearer(), ORIGIN, { text: 'export fails' }), ctx(id))
  expect(m.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  expect(await m.text()).toContain('event: turn')
  const done = await submit.POST(call(bearer(), ORIGIN), ctx(id))
  expect(done.status).toBe(200)
  expect(await done.json()).toHaveProperty('number')
})

it('answers 403 without CORS headers for a wrong or missing Origin, an unknown token and a revoked token', async () => {
  const bad = [call(bearer(), 'https://evil.example.com'), call(bearer(), null), call('Bearer bemb_nope', ORIGIN)]
  const revoked = await embed.createEmbedToken(payload, { product: productId, name: 'old', allowedOrigins: [ORIGIN] })
  expect((await sessions.POST(call(bearer(revoked), ORIGIN))).status).toBe(201)
  await payload.update({ collection: 'embed_tokens', where: { tokenHash: { equals: embed.hashToken(revoked) } }, data: { revokedAt: new Date().toISOString() }, ...o })
  bad.push(call(bearer(revoked), ORIGIN))
  for (const req of bad) {
    const r = await sessions.POST(req)
    expect(r.status).toBe(403)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect(JSON.stringify(await r.json())).not.toContain('bemb_')
  }
})

it('a token cannot reach sessions of a Bauherr or another token (404)', async () => {
  const { id } = await (await sessions.POST(call(`bauherren API-Key ${keyA}`, null, { product: productId }))).json()
  expect((await messages.POST(call(bearer(), ORIGIN, { text: 'hi' }), ctx(id))).status).toBe(404)
  expect((await submit.POST(call(bearer(), ORIGIN), ctx(id))).status).toBe(404)
  const other = await embed.createEmbedToken(payload, { product: productId, name: 'other', allowedOrigins: [ORIGIN] })
  const mine = (await (await sessions.POST(call(bearer(), ORIGIN))).json()).id
  expect((await submit.POST(call(bearer(other), ORIGIN), ctx(mine))).status).toBe(404)
  expect((await sessions.POST(call(null, ORIGIN))).status).toBe(401)
})

it('caps sessions per hour per token', async () => {
  const capped = await embed.createEmbedToken(payload, { product: productId, name: 'capped', allowedOrigins: [ORIGIN], maxSessionsPerHour: 1 })
  expect((await sessions.POST(call(bearer(capped), ORIGIN))).status).toBe(201)
  expect((await sessions.POST(call(bearer(capped), ORIGIN))).status).toBe(429)
})

it('preflight echoes the Origin and allows the Authorization header', () => {
  const r = embed.preflight(new Request('http://x.test', { method: 'OPTIONS', headers: { origin: ORIGIN } }))
  expect(r.status).toBe(204)
  expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN)
  expect(r.headers.get('access-control-allow-headers')).toContain('authorization')
  expect(sessions.OPTIONS).toBe(embed.preflight)
})

it('serves the widget as a self-contained script', async () => {
  const r = widgetRoute.GET()
  expect(r.headers.get('content-type')).toContain('javascript')
  const js = await r.text()
  expect(js).toContain('attachShadow')
  expect(() => new Function(js)).not.toThrow()
  expect(() => new Function(`${js.replace('(document.currentScript)', '(null)')}`)()).not.toThrow()
})
