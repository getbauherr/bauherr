import type { Payload } from 'payload'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

const claims = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('../src/lib/oidc', async (orig) => ({ ...(await orig<typeof import('../src/lib/oidc')>()), finishLogin: async () => claims.current }))

const o = { overrideAccess: true, depth: 0 } as const
const iss = 'https://idp.test/realms/x'
let payload: Payload
let testDb: TestDb
let GET: typeof import('../src/app/(app)/auth/oidc/callback/route').GET
let warn: ReturnType<typeof vi.spyOn>

const setClaims = (sub: string, email: string, roles: string[]) => (claims.current = { iss, sub, email, email_verified: true, realm_access: { roles } })
const call = () =>
  GET(new NextRequest('http://bauherr.test/auth/oidc/callback?code=c&state=s', { headers: { cookie: `bauherr-oidc=${encodeURIComponent(JSON.stringify({ state: 's', nonce: 'n', verifier: 'v' }))}` } }))
const byEmail = async (email: string) => (await payload.find({ collection: 'bauherren', where: { email: { equals: email } }, limit: 1, ...o })).docs[0]

beforeAll(async () => {
  testDb = await createTestDb('oidc_callback_542')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  process.env.OIDC_ISSUER = iss
  process.env.OIDC_CLIENT_ID = 'bauherr'
  process.env.OIDC_CLIENT_SECRET = 'client-secret'
  process.env.PUBLIC_URL = 'http://bauherr.test'
  process.env.OIDC_BAUHERR_ROLE = 'bauherr-user'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  ;({ GET } = await import('../src/app/(app)/auth/oidc/callback/route'))
})

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

beforeEach(() => {
  warn?.mockRestore()
  warn = vi.spyOn(payload.logger, 'warn')
})

describe('oidc callback with OIDC_BAUHERR_ROLE set', () => {
  it('refuses a new user without the role: no account, generic log', async () => {
    setClaims('s-new', 'new@x.io', [])
    const res = await call()
    expect(res.headers.get('location')).toContain('/login?error=oidc-role')
    expect(res.cookies.get('bauherr-session')).toBeUndefined()
    expect(await byEmail('new@x.io')).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('oidc_login_refused')
  })

  it('refuses an existing SSO account whose role is gone and invalidates its sessions', async () => {
    const user = await payload.create({ collection: 'bauherren', data: { email: 'old@x.io', password: 'x'.repeat(32), oidcSubject: `${iss}|s-old` }, context: { oidc: true }, ...o })
    setClaims('s-old', 'old@x.io', [])
    const res = await call()
    expect(res.headers.get('location')).toContain('/login?error=oidc-role')
    expect(res.cookies.get('bauherr-session')).toBeUndefined()
    expect((await payload.findByID({ collection: 'bauherren', id: user.id, ...o })).sessionVersion).toBe((user.sessionVersion ?? 0) + 1)
    expect(warn).toHaveBeenCalledWith('oidc_login_refused')
  })

  it('logs in and creates the account for a user with the role', async () => {
    setClaims('s-ok', 'ok@x.io', ['bauherr-user'])
    const res = await call()
    expect(res.headers.get('location')).not.toContain('/login')
    expect(res.cookies.get('bauherr-session')).toBeDefined()
    expect((await byEmail('ok@x.io')).oidcSubject).toBe(`${iss}|s-ok`)
    expect(warn).not.toHaveBeenCalled()
  })
})
