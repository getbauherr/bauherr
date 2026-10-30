import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { claimAt, emailOk, mergeClaims, resolveAccount, roleFrom, syncFrom, workspaceSlugsFrom } from '../src/lib/oidc'
import { oidcStrategy, SESSION_COOKIE, signSession, SESSION_TTL_S, verifySession } from '../src/lib/oidc-session'

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
