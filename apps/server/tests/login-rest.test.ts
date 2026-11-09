import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
let POST: (req: Request, ctx: { params: Promise<{ slug: string[] }> }) => Promise<Response>
const o = { overrideAccess: true } as const
const generic = 'The email or password provided is incorrect.'

beforeAll(async () => {
  testDb = await createTestDb('login_rest')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  POST = (await import('../src/app/(payload)/api/[...slug]/route')).POST as never
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const account = (email: string) => payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
/** `ip` arrives as the last hop behind a spoofed first one; `xff` sets the raw header instead (null = none). */
const login = (email: string, password = 'pw-123456', ip?: string, xff?: string | null) => {
  const header = xff !== undefined ? xff : ip && `203.0.113.9, ${ip}`
  return POST(new Request('http://localhost/api/bauherren/login', { method: 'POST', headers: { 'content-type': 'application/json', ...(header && { 'x-forwarded-for': header }) }, body: JSON.stringify({ email, password }) }), { params: Promise.resolve({ slug: ['bauherren', 'login'] }) })
}

it('REST sign-in answers like Payload and 2 parallel sign-ins keep both sessions', async () => {
  const email = 'rest-two@x.io'
  const { id } = await account(email)
  const res = await Promise.all([login(email), login(email)])
  expect(res.map((r) => r.status)).toEqual([200, 200])
  for (const r of res) {
    expect(r.headers.get('set-cookie')).toMatch(/^payload-token=/)
    const body = await r.json()
    expect(body).toMatchObject({ message: 'Authentication Passed', user: { email }, exp: expect.any(Number) })
    const { user } = await payload.auth({ headers: new Headers({ Authorization: `JWT ${body.token}` }) })
    expect(user?.email).toBe(email)
  }
  expect((await payload.findByID({ collection: 'bauherren', id, ...o })).sessions).toHaveLength(2)
}, 20_000)

it('6 parallel REST sign-ins of one account: at least one 429 with the generic message, none hangs', async () => {
  const email = 'rest-six@x.io'
  await account(email)
  const res = await Promise.all(Array.from({ length: 12 }, () => login(email)))
  const refused = res.filter((r) => r.status === 429)
  expect(refused.length).toBeGreaterThan(0)
  expect((await refused[0]!.json()).errors[0].message).toBe(generic)
  expect(res.every((r) => [200, 429].includes(r.status))).toBe(true)
}, 20_000)

it('a wrong password is 401 with Payload\'s message', async () => {
  const email = 'rest-wrong@x.io'
  await account(email)
  const res = await login(email, 'nope')
  expect(res.status).toBe(401)
  expect((await res.json()).errors[0].message).toBe(generic)
})

it('an IP over the limit of failed sign-ins is refused at once while another IP signs in to the same account', async () => {
  const { loginLimits } = await import('../src/lib/login-lock')
  const email = 'rest-ip@x.io'
  await account(email)
  // Failures spread over unknown accounts, like credential stuffing (one account would hit Payload's own lockout first).
  for (let i = 0; i < loginLimits().maxIpFailures; i++) expect((await login(`nobody-${i}@x.io`, 'nope', '203.0.113.7')).status).toBe(401)
  const refused = await login(email, 'pw-123456', '203.0.113.7')
  expect(refused.status).toBe(429)
  expect((await refused.json()).errors[0].message).toBe(generic)
  expect((await login(email, 'pw-123456', '203.0.113.8')).status).toBe(200)
}, 20_000)

it('successful sign-ins do not count toward the IP limit (an office behind one NAT)', async () => {
  const { loginLimits } = await import('../src/lib/login-lock')
  const email = 'rest-nat@x.io'
  await account(email)
  for (let i = 0; i < loginLimits().maxIpFailures + 2; i++) expect((await login(email, 'pw-123456', '203.0.113.20')).status).toBe(200)
}, 20_000)

it('GraphQL is off: /api/graphql serves no login mutation', async () => {
  const res = await POST(new Request('http://localhost/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'mutation { loginBauherren(email: "a@x.io", password: "x") { token } }' }) }), { params: Promise.resolve({ slug: ['graphql'] }) })
  expect(res.status).toBe(404)
  expect(await res.text()).not.toContain('token')
})

it('requests that skip the proxy chain share one bucket: omitting or forging x-forwarded-for gives no fresh budget', async () => {
  const { loginLimits } = await import('../src/lib/login-lock')
  const email = 'rest-unverified@x.io'
  await account(email)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  process.env.TRUSTED_PROXY_HOPS = '2'
  try {
    // Earlier tests without a header already drew from the same bucket: at most maxIpFailures failures with varying, forged or absent headers reach the limit.
    let failed = 0
    while (failed <= loginLimits().maxIpFailures && (await login(`ghost-${failed}@x.io`, 'nope', undefined, failed % 2 ? `198.51.100.${failed}` : null)).status === 401) failed++
    expect(failed).toBeLessThanOrEqual(loginLimits().maxIpFailures)
    expect((await login(email, 'pw-123456', undefined, '198.51.100.99')).status).toBe(429)
    expect((await login(email, 'pw-123456', undefined, null)).status).toBe(429)
    expect((await login(email, 'pw-123456', undefined, '203.0.113.30, 10.0.0.2')).status).toBe(200)
  } finally {
    delete process.env.TRUSTED_PROXY_HOPS
    warn.mockRestore()
  }
}, 20_000)
