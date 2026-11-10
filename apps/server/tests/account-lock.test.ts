import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { lockedRequests } from '../src/lib/oidc-session'
import { mintAgentKey, resolveAgentKey, rotateApiKey } from '../src/lib/api-key'
import { createTestDb, type TestDb } from './helpers/test-db'

const day = 86400_000
const hidden = ['hash', 'salt', 'loginAttempts', 'lockUntil']
const states = { locked: new Date(Date.now() + day), expired: new Date(Date.now() - day), unlocked: undefined } as const

let payload: Payload
let testDb: TestDb
beforeAll(async () => {
  testDb = await createTestDb('account_lock')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const bauherr = async (name: string, lockUntil?: Date) => {
  const b = await payload.create({ collection: 'bauherren', data: { email: `${name}@x.io`, password: 'pw-123456-x', role: 'bauherr' } as never, overrideAccess: true })
  if (lockUntil) await payload.update({ collection: 'bauherren', id: b.id, data: { lockUntil: lockUntil.toISOString(), loginAttempts: 5 } as never, overrideAccess: true })
  return b
}

describe.each(Object.entries(states))('%s account', (state, lockUntil) => {
  it('agent key', async () => {
    const b = await bauherr(`agent-${state}`, lockUntil)
    const token = await mintAgentKey(payload, b, 'ci')
    if (state === 'locked') return expect(resolveAgentKey(payload, token)).rejects.toThrow(/locked/)
    const r = await resolveAgentKey(payload, token)
    expect(r?.owner.email).toBe(b.email)
    for (const k of hidden) expect(r?.owner).not.toHaveProperty(k)
  })

  it('Payload API key', async () => {
    const b = await bauherr(`apikey-${state}`, lockUntil)
    const key = await rotateApiKey(payload, b)
    const headers = new Headers({ authorization: `bauherren API-Key ${key}` })
    const user = (await payload.auth({ headers, req: { headers } as never })).user as Record<string, unknown> | null
    if (state === 'locked') {
      expect(user).toBeNull()
      return expect(lockedRequests.has(headers)).toBe(true)
    }
    expect(user?.email).toBe(b.email)
    for (const k of hidden) expect(user).not.toHaveProperty(k)
  })
})

const authed = async (headers: Headers) => (await payload.auth({ headers, req: { headers } as never })).user as Record<string, unknown> | null
const signIn = async (b: object) => (await payload.login({ collection: 'bauherren', data: { email: (b as { email: string }).email, password: 'pw-123456-x' } })).token as string

describe('local JWT', () => {
  it.each([
    ['cookie', (t: string) => ({ cookie: `payload-token=${t}` })],
    ['Authorization: JWT', (t: string) => ({ authorization: `JWT ${t}` })],
  ])('%s: a locked account gets no user, an unlocked one does', async (_, h) => {
    const ok = await bauherr(`jwt-ok-${_.length}`)
    expect((await authed(new Headers(h(await signIn(ok)))))?.email).toBe(ok.email)
    const b = await bauherr(`jwt-locked-${_.length}`)
    const token = await signIn(b)
    await payload.update({ collection: 'bauherren', id: b.id, data: { lockUntil: new Date(Date.now() + day).toISOString() } as never, overrideAccess: true })
    expect(await authed(new Headers(h(token)))).toBeNull()
  })

  it('a session cookie plus a locked API key authenticates as the cookie user', async () => {
    const cookieUser = await bauherr('mixed-cookie')
    const locked = await bauherr('mixed-locked', new Date(Date.now() + day))
    const key = await rotateApiKey(payload, locked)
    const user = await authed(new Headers({ cookie: `payload-token=${await signIn(cookieUser)}`, authorization: `bauherren API-Key ${key}` }))
    expect(user?.email).toBe(cookieUser.email)
  })
})

describe('failed lock read', () => {
  it('refuses the agent key and the API key', async () => {
    const b = await bauherr('failed-read')
    const token = await mintAgentKey(payload, b, 'ci')
    const key = await rotateApiKey(payload, b)
    const find = payload.findByID.bind(payload)
    const spy = vi.spyOn(payload, 'findByID').mockImplementation(((a: { select?: { lockUntil?: boolean } }) => (a.select?.lockUntil ? Promise.reject(new Error('db down')) : find(a as never))) as never)
    try {
      await expect(resolveAgentKey(payload, token)).rejects.toThrow(/locked/)
      expect(await authed(new Headers({ authorization: `bauherren API-Key ${key}` }))).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it.each([
    ['cookie', (t: string) => ({ cookie: `payload-token=${t}` })],
    ['Authorization: JWT', (t: string) => ({ authorization: `JWT ${t}` })],
  ])('refuses a JWT via %s', async (_, h) => {
    const b = await bauherr(`failed-jwt-${_.length}`)
    const token = await signIn(b)
    const find = payload.findByID.bind(payload)
    const spy = vi.spyOn(payload, 'findByID').mockImplementation(((a: { select?: { lockUntil?: boolean } }) => (a.select?.lockUntil ? Promise.reject(new Error('db down')) : find(a as never))) as never)
    try {
      expect(await authed(new Headers(h(token)))).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('/mcp', () => {
  it('answers 401 "This account is locked." for a locked account key', async () => {
    const key = await rotateApiKey(payload, await bauherr('mcp-locked', new Date(Date.now() + day)))
    const { POST } = await import('../src/app/mcp/route')
    const res = await POST(new Request('http://localhost/mcp', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: '{}' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error.message).toBe('This account is locked.')
  })
})
