import type { Payload } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/test-db'

let payload: Payload
let testDb: TestDb
const o = { overrideAccess: true } as const

beforeAll(async () => {
  testDb = await createTestDb('login_sessions')
  process.env.DATABASE_URL = testDb.url
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  const { getPayload } = await import('payload')
  payload = await getPayload({ config: (await import('../src/payload.config')).default })
})

/** The login action's own password sign-in (`signInWithPassword`): the token, or a throw. */
const signIn = async (email: string, password: string) => (await import('../src/lib/login-lock')).signInWithPassword(payload, email, password)

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('two parallel password sign-ins keep both sessions; OIDC sign-in leaves sessions untouched', async () => {
  const { oidcStrategy, SESSION_COOKIE, signSession } = await import('../src/lib/oidc-session')
  const email = 'parallel@x.io'
  const created = await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const tokens = await Promise.all([signIn(email, 'pw-123456'), signIn(email, 'pw-123456')])

  for (const token of tokens) {
    const { user } = await payload.auth({ headers: new Headers({ Authorization: `JWT ${token}` }) })
    expect(user?.email).toBe(email)
  }
  const sessionsOf = async () => (await payload.findByID({ collection: 'bauherren', id: created.id, ...o })).sessions
  const before = await sessionsOf()
  expect(before).toHaveLength(2)

  const oidc = await oidcStrategy.authenticate({ payload, headers: new Headers({ cookie: `${SESSION_COOKIE}=${signSession(created.id, 0)}` }) } as never)
  expect(oidc.user).toMatchObject({ id: created.id })
  expect(await sessionsOf()).toEqual(before)
})

it('more parallel sign-ins than pool connections (different emails) do not deadlock the pool', async () => {
  const emails = Array.from({ length: 15 }, (_, i) => `pool${i}@x.io`)
  for (const email of emails) await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const tokens = await Promise.all(emails.map((email) => signIn(email, 'pw-123456')))
  expect(tokens.every(Boolean)).toBe(true)
}, 20_000)

it('a wrong password rejects with 401 and releases the lock for the next sign-in', async () => {
  const email = 'wrong@x.io'
  await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  await expect(signIn(email, 'nope')).rejects.toMatchObject({ status: 401 })
  expect(await signIn(email, 'pw-123456')).toBeTruthy()
}, 20_000)

it('more parallel sign-ins of one account than the cap: 5 settle as before, 9 are refused at once; the cap frees up', async () => {
  const { LoginBusy, MAX_LOGIN_WAITERS } = await import('../src/lib/login-lock')
  const email = 'crowd@x.io'
  await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const r = await Promise.allSettled(Array.from({ length: 14 }, (_, i) => signIn(email, i === 0 ? 'nope' : 'pw-123456')))
  expect(MAX_LOGIN_WAITERS).toBe(5)
  expect(r[0]).toMatchObject({ status: 'rejected', reason: { status: 401 } })
  expect(r.slice(1, 5).every((x) => x.status === 'fulfilled' && x.value)).toBe(true)
  expect(r.slice(5).every((x) => x.status === 'rejected' && x.reason instanceof LoginBusy)).toBe(true)
  expect(await signIn(email, 'pw-123456')).toBeTruthy()
}, 20_000)

it('more parallel wrong passwords on distinct accounts than pool connections all reject, none hangs', async () => {
  const emails = Array.from({ length: 14 }, (_, i) => `wrong${i}@x.io`)
  for (const email of emails) await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const r = await Promise.allSettled(emails.map((email) => signIn(email, 'nope')))
  expect(r.every((x) => x.status === 'rejected' && (x.reason as { status?: number }).status === 401)).toBe(true)
}, 20_000)
