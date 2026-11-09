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

afterAll(async () => {
  await payload?.destroy()
  await testDb?.drop(payload)
})

it('two parallel password sign-ins keep both sessions; OIDC sign-in leaves sessions untouched', async () => {
  const { withLoginLock } = await import('../src/lib/login-lock')
  const { oidcStrategy, SESSION_COOKIE, signSession } = await import('../src/lib/oidc-session')
  const email = 'parallel@x.io'
  const created = await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const login = () => withLoginLock(payload, email, (req) => payload.login({ collection: 'bauherren', data: { email, password: 'pw-123456' }, req }))

  const [first, second] = await Promise.all([login(), login()])

  for (const { token } of [first, second]) {
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
  const { withLoginLock } = await import('../src/lib/login-lock')
  const emails = Array.from({ length: 15 }, (_, i) => `pool${i}@x.io`)
  for (const email of emails) await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const results = await Promise.all(
    emails.map((email) => withLoginLock(payload, email, (req) => payload.login({ collection: 'bauherren', data: { email, password: 'pw-123456' }, req }))),
  )
  expect(results.every((r) => r.token)).toBe(true)
}, 20_000)

it('a wrong password rejects with 401 and releases the lock for the next sign-in', async () => {
  const { withLoginLock } = await import('../src/lib/login-lock')
  const email = 'wrong@x.io'
  await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456', role: 'bauherr' }, ...o })
  const login = (password: string) => withLoginLock(payload, email, (req) => payload.login({ collection: 'bauherren', data: { email, password }, req }))

  await expect(login('nope')).rejects.toMatchObject({ status: 401 })
  expect((await login('pw-123456')).token).toBeTruthy()
}, 20_000)
