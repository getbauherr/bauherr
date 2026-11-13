import { createHmac } from 'node:crypto'
import type { Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { claimAt, emailOk, mergeClaims, resolveAccount, roleFrom, roleRequired, syncFrom, workspaceSlugsFrom } from '../src/lib/oidc'
import { createTestDb, type TestDb } from './helpers/test-db'
import { isLocked, oidcStrategy, SESSION_COOKIE, signSession, SESSION_TTL_S, verifySession } from '../src/lib/oidc-session'

const claims = { realm_access: { roles: ['offline_access', 'bauherr-admin'] }, groups: ['/acme', 'beta', 7] }

describe('claim mapping', () => {
  it('reads dot paths', () => {
    expect(claimAt(claims, 'realm_access.roles')).toEqual(['offline_access', 'bauherr-admin'])
    expect(claimAt(claims, 'a.b.c')).toBeUndefined()
  })
  it('maps the admin role, else bauherr', () => {
    expect(roleFrom(claims, 'realm_access.roles', 'bauherr-admin')).toBe('admin')
    expect(roleFrom(claims, 'realm_access.roles', 'other')).toBe('bauherr')
    expect(roleFrom({}, 'realm_access.roles', 'bauherr-admin')).toBe('bauherr')
    expect(roleFrom({ role: 'bauherr-admin' }, 'role', 'bauherr-admin')).toBe('admin')
  })
  it('strips the leading slash and ignores non-strings', () => {
    expect(workspaceSlugsFrom(claims, 'groups')).toEqual(['acme', 'beta'])
    expect(workspaceSlugsFrom({}, 'groups')).toEqual([])
  })
})

describe('OIDC_BAUHERR_ROLE', () => {
  const po = 'po'
  it('grants bauherr only for that value when set', () => {
    expect(roleFrom({ r: ['x'] }, 'r', 'adm', undefined, 'bh')).toBeUndefined()
    expect(roleFrom({ r: ['bh'] }, 'r', 'adm', undefined, 'bh')).toBe('bauherr')
  })
  it('keeps admin and product owner winning', () => {
    expect(roleFrom({ r: ['bh', 'adm'] }, 'r', 'adm', po, 'bh')).toBe('admin')
    expect(roleFrom({ r: ['bh', po] }, 'r', 'adm', po, 'bh')).toBe('product-owner')
    expect(roleFrom({ r: [po] }, 'r', 'adm', po, 'bh')).toBe('product-owner')
  })
  it('refuses a missing claim when set, keeps today when unset', () => {
    expect(roleFrom({}, 'r', 'adm', undefined, 'bh')).toBeUndefined()
    expect(roleFrom({}, 'r', 'adm', undefined, undefined)).toBe('bauherr')
  })
  it('syncFrom yields no role for unmapped or absent claims when set', () => {
    vi.stubEnv('OIDC_BAUHERR_ROLE', 'bh')
    try {
      expect(roleRequired()).toBe(true)
      expect(syncFrom({}).role).toBeUndefined()
      expect(syncFrom({ realm_access: { roles: ['offline_access'] } }).role).toBeUndefined()
      expect(syncFrom({ realm_access: { roles: ['bh'] } }).role).toBe('bauherr')
    } finally {
      vi.unstubAllEnvs()
    }
    expect(roleRequired()).toBe(false)
    expect(syncFrom({})).toEqual({})
  })
})

describe('account resolution', () => {
  const base = { subject: 'https://i|1', email: 'a@x.io' }
  it('logs in on subject match', () => expect(resolveAccount({ ...base, existingBySubject: {}, existingByEmail: {} })).toEqual({ action: 'login' }))
  it('refuses an email collision without subject match', () => expect(resolveAccount({ ...base, existingByEmail: {} })).toEqual({ action: 'refuse', reason: 'link-required' }))
  it('creates when nothing matches', () => expect(resolveAccount(base)).toEqual({ action: 'create' }))
})

describe('claims', () => {
  it('requires email_verified === true', () => {
    expect(emailOk({ email: 'a@x.io', email_verified: true })).toBe(true)
    for (const v of [false, undefined, 'true', 1]) expect(emailOk({ email: 'a@x.io', email_verified: v })).toBe(false)
    expect(emailOk({ email_verified: true })).toBe(false)
  })
  it('ID-token claims win over userinfo', () => expect(mergeClaims({ email: 'info', a: 1 }, { email: 'id' })).toEqual({ email: 'id', a: 1 }))
  it('syncs only present claims', () => {
    expect(syncFrom({})).toEqual({})
    expect(syncFrom({ realm_access: { roles: [] } })).toEqual({ role: 'bauherr' })
    expect(syncFrom({ groups: [] })).toEqual({ slugs: [] })
    expect(syncFrom(claims)).toEqual({ role: 'admin', slugs: ['acme', 'beta'] })
  })
})

describe('session token', () => {
  const now = 1_700_000_000_000
  const forge = (payload: object, key = 'k') => {
    const b = (x: object) => Buffer.from(JSON.stringify(x)).toString('base64url')
    const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b(payload)}`
    return `${body}.${createHmac('sha256', key).update(body).digest().toString('base64url')}`
  }
  const exp = now / 1000 + 100
  it('round-trips id and version', () => expect(verifySession(signSession(5, 2, 'k', now), 'k', now + 1000)).toEqual({ id: 5, v: 2 }))
  it('expires', () => expect(verifySession(signSession(5, 0, 'k', now), 'k', now + (SESSION_TTL_S + 1) * 1000)).toBeNull())
  it('lasts 14 days', () => {
    expect(SESSION_TTL_S).toBe(14 * 86400)
    expect(verifySession(signSession(5, 0, 'k', now), 'k', now + 13 * 86400_000)).toEqual({ id: 5, v: 0 })
    expect(verifySession(signSession(5, 0, 'k', now), 'k', now + 14 * 86400_000 + 1000)).toBeNull()
  })
  it('checks typ, aud and v', () => {
    const ok = { id: 1, v: 0, typ: 'bauherr-session', aud: 'bauherr', exp }
    expect(verifySession(forge(ok), 'k', now)).toEqual({ id: 1, v: 0 })
    expect(verifySession(forge({ ...ok, typ: 'JWT' }), 'k', now)).toBeNull()
    expect(verifySession(forge({ ...ok, aud: 'x' }), 'k', now)).toBeNull()
    expect(verifySession(forge({ ...ok, v: undefined }), 'k', now)).toBeNull()
  })
  it('rejects a wrong key or tampered body', () => {
    const t = signSession(5, 0, 'k', now)
    expect(verifySession(t, 'other', now)).toBeNull()
    const [h, , s] = t.split('.')
    expect(verifySession(`${h}.${Buffer.from('{"id":1,"exp":9999999999}').toString('base64url')}.${s}`, 'k', now)).toBeNull()
    expect(verifySession('garbage', 'k', now)).toBeNull()
  })
})

describe('oidc strategy', () => {
  beforeAll(() => {
    process.env.PAYLOAD_SECRET = 'test-secret'
  })
  const run = (doc: object | null, v = 0) => {
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=${signSession(7, v)}` })
    const payload = { findByID: async () => (doc ? doc : Promise.reject(new Error('nf'))) }
    return oidcStrategy.authenticate({ payload, headers } as never)
  }
  it('accepts a valid session', async () => expect((await run({ id: 7, sessionVersion: 0 })).user).toMatchObject({ id: 7, _strategy: 'oidc' }))
  it('rejects a stale version', async () => expect((await run({ id: 7, sessionVersion: 1 })).user).toBeNull())
  it('rejects a locked user', async () => expect((await run({ id: 7, sessionVersion: 0, lockUntil: new Date(Date.now() + 60_000).toISOString() })).user).toBeNull())
  it('rejects a missing user', async () => expect((await run(null)).user).toBeNull())
})

describe('oidc strategy against the database', () => {
  let payload: Payload
  let testDb: TestDb
  beforeAll(async () => {
    testDb = await createTestDb('oidc_lock')
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
  const day = 86400_000
  const authFor = async (email: string, lockUntil?: Date) => {
    const b = await payload.create({ collection: 'bauherren', data: { email, password: 'pw-123456-x', role: 'bauherr' } as never, overrideAccess: true })
    if (lockUntil) await payload.update({ collection: 'bauherren', id: b.id, data: { lockUntil: lockUntil.toISOString(), loginAttempts: 5 } as never, overrideAccess: true })
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=${signSession(b.id, b.sessionVersion ?? 0)}` })
    return { b, user: (await payload.auth({ headers })).user as Record<string, unknown> | null }
  }
  it('rejects a locked Bauherr', async () => {
    const { b, user } = await authFor('locked@example.com', new Date(Date.now() + day))
    const stored = await payload.findByID({ collection: 'bauherren', id: b.id, overrideAccess: true, showHiddenFields: true })
    expect(user).toBeNull()
    expect(isLocked(stored.lockUntil)).toBe(true)
  })
  it('accepts an expired lock', async () => expect((await authFor('expired@example.com', new Date(Date.now() - day))).user).toMatchObject({ _strategy: 'oidc' }))
  it('accepts an unlocked Bauherr without hidden auth fields', async () => {
    const { user } = await authFor('open@example.com')
    expect(user).toMatchObject({ _strategy: 'oidc' })
    for (const k of ['hash', 'salt', 'loginAttempts', 'lockUntil']) expect(user).not.toHaveProperty(k)
  })
})
