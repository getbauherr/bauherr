import { createLocalReq, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { lockedRequests } from '../src/lib/oidc-session'
import { mintAgentKey, resolveAgentKey, rotateApiKey } from '../src/lib/api-key'
import { createTestDb, type TestDb } from './helpers/test-db'

const day = 86400_000
const hidden = ['hash', 'salt', 'loginAttempts', 'lockUntil']
const states = { locked: new Date(Date.now() + day), expired: new Date(Date.now() - day), unlocked: undefined } as const

let payload: Payload
let testDb: TestDb
let workspace: number
beforeAll(async () => {
  testDb = await createTestDb('account_lock')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
  const made = await payload.create({ collection: 'workspaces', data: { name: 'w', slug: 'w' }, overrideAccess: true })
  workspace = Number(made.id)
})
afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

const bauherr = async (name: string, lockUntil?: Date) => {
  const b = await payload.create({
    collection: 'bauherren',
    data: { email: `${name}@x.io`, password: 'pw-123456-x', role: 'bauherr', tenants: [{ tenant: workspace }] },
    overrideAccess: true,
  })
  if (lockUntil)
    await payload.update({
      collection: 'bauherren',
      id: b.id,
      data: { lockUntil: lockUntil.toISOString(), loginAttempts: 5 },
      overrideAccess: true,
    })
  return b
}

describe.each(Object.entries(states))('%s account', (state, lockUntil) => {
  it('agent key', async () => {
    const b = await bauherr(`agent-${state}`, lockUntil)
    const token = await mintAgentKey(payload, b, 'ci', workspace)
    if (state === 'locked') return expect(resolveAgentKey(payload, token)).rejects.toThrow(/locked/)
    const r = await resolveAgentKey(payload, token)
    expect(r?.owner.email).toBe(b.email)
    for (const k of hidden) expect(r?.owner).not.toHaveProperty(k)
  })

  it('Payload API key', async () => {
    const b = await bauherr(`apikey-${state}`, lockUntil)
    const key = await rotateApiKey(payload, b)
    const headers = new Headers({ authorization: `bauherren API-Key ${key}` })
    const user = await authed(headers)
    if (state === 'locked') {
      expect(user).toBeNull()
      return expect(lockedRequests.has(headers)).toBe(true)
    }
    expect(user?.email).toBe(b.email)
    for (const k of hidden) expect(user).not.toHaveProperty(k)
  })
})

const authed = async (headers: Headers): Promise<Record<string, unknown> | null> => {
  const req = await createLocalReq({ req: { headers } }, payload)
  return (await payload.auth({ headers, req })).user
}
const signIn = async (b: object) => {
  const { email } = z.object({ email: z.string() }).parse(b)
  const login = await payload.login({ collection: 'bauherren', data: { email, password: 'pw-123456-x' } })
  return z.string().parse(login.token)
}

describe('local JWT', () => {
  it.each([
    ['cookie', (t: string) => ({ cookie: `payload-token=${t}` })],
    ['Authorization: JWT', (t: string) => ({ authorization: `JWT ${t}` })],
  ])('%s: a locked account gets no user, an unlocked one does', async (_, h) => {
    const ok = await bauherr(`jwt-ok-${_.length}`)
    expect((await authed(new Headers(h(await signIn(ok)))))?.email).toBe(ok.email)
    const b = await bauherr(`jwt-locked-${_.length}`)
    const token = await signIn(b)
    await payload.update({
      collection: 'bauherren',
      id: b.id,
      data: { lockUntil: new Date(Date.now() + day).toISOString() },
      overrideAccess: true,
    })
    expect(await authed(new Headers(h(token)))).toBeNull()
  })

  it('a session cookie plus a locked API key authenticates as the cookie user', async () => {
    const cookieUser = await bauherr('mixed-cookie')
    const locked = await bauherr('mixed-locked', new Date(Date.now() + day))
    const key = await rotateApiKey(payload, locked)
    const user = await authed(
      new Headers({ cookie: `payload-token=${await signIn(cookieUser)}`, authorization: `bauherren API-Key ${key}` }),
    )
    expect(user?.email).toBe(cookieUser.email)
  })
})

describe('failed lock read', () => {
  it('refuses the agent key and the API key', async () => {
    const b = await bauherr('failed-read')
    const token = await mintAgentKey(payload, b, 'ci', workspace)
    const key = await rotateApiKey(payload, b)
    const find = payload.findByID.bind(payload)
    const spy = vi
      .spyOn(payload, 'findByID')
      .mockImplementation((a) => (a.select?.lockUntil ? Promise.reject(new Error('db down')) : find(a)))
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
    const spy = vi
      .spyOn(payload, 'findByID')
      .mockImplementation((a) => (a.select?.lockUntil ? Promise.reject(new Error('db down')) : find(a)))
    try {
      expect(await authed(new Headers(h(token)))).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })
})
