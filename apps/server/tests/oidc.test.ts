import { describe, expect, it } from 'vitest'
import { claimAt, roleFrom, workspaceSlugsFrom } from '../src/lib/oidc'
import { signSession, SESSION_TTL_S, verifySession } from '../src/lib/oidc-session'

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

describe('session token', () => {
  const now = 1_700_000_000_000
  it('round-trips', () => expect(verifySession(signSession(5, 'k', now), 'k', now + 1000)).toBe(5))
  it('expires', () => expect(verifySession(signSession(5, 'k', now), 'k', now + (SESSION_TTL_S + 1) * 1000)).toBeNull())
  it('rejects a wrong key or tampered body', () => {
    const t = signSession(5, 'k', now)
    expect(verifySession(t, 'other', now)).toBeNull()
    const [h, , s] = t.split('.')
    expect(verifySession(`${h}.${Buffer.from('{"id":1,"exp":9999999999}').toString('base64url')}.${s}`, 'k', now)).toBeNull()
    expect(verifySession('garbage', 'k', now)).toBeNull()
  })
})
