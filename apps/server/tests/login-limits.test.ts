import { expect, it, vi } from 'vitest'
import { clientIp, loginLimits, UNVERIFIED_IP } from '../src/lib/login-lock'

const xff = (v: string) => new Headers({ 'x-forwarded-for': v })

it('defaults: 10 failed sign-ins per IP, 1 trusted proxy hop', () => {
  expect(loginLimits({})).toEqual({ maxIpFailures: 10, trustedProxyHops: 1 })
  expect(loginLimits({ LOGIN_IP_MAX_ATTEMPTS: '25', TRUSTED_PROXY_HOPS: '0' })).toEqual({ maxIpFailures: 25, trustedProxyHops: 0 })
})

it.each([['LOGIN_IP_MAX_ATTEMPTS', 'ten'], ['LOGIN_IP_MAX_ATTEMPTS', '0'], ['TRUSTED_PROXY_HOPS', 'one'], ['TRUSTED_PROXY_HOPS', '-1'], ['TRUSTED_PROXY_HOPS', '1.5']])('%s=%s throws at boot', (name, v) => {
  expect(() => loginLimits({ [name]: v })).toThrow(`${name} must be`)
})

it('1 hop: the last entry, so a spoofed first hop is ignored', () => {
  expect(clientIp(xff('6.6.6.6, 203.0.113.7'), 1)).toBe('203.0.113.7')
  expect(clientIp(xff('203.0.113.7'), 1)).toBe('203.0.113.7')
})

it('2 hops: the second entry from the right; a spoofed first hop is ignored', () => {
  expect(clientIp(xff('6.6.6.6, 203.0.113.7, 10.0.0.2'), 2)).toBe('203.0.113.7')
  expect(clientIp(xff('203.0.113.7, 10.0.0.2'), 2)).toBe('203.0.113.7')
})

it('0 hops: no IP, so the IP limit is off', () => {
  expect(clientIp(xff('6.6.6.6, 203.0.113.7'), 0)).toBeUndefined()
  expect(clientIp(new Headers(), 0)).toBeUndefined()
})

it('fewer x-forwarded-for entries than hops (or none) share the unverified key, warned at most every 10 min', () => {
  vi.useFakeTimers({ now: Date.now() + 24 * 3600_000 })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(clientIp(xff('10.0.0.2'), 2)).toBe(UNVERIFIED_IP)
    expect(clientIp(xff('6.6.6.6'), 2)).toBe(UNVERIFIED_IP)
    expect(clientIp(new Headers(), 1)).toBe(UNVERIFIED_IP)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toBe('login IP key: request had 1 x-forwarded-for entries, TRUSTED_PROXY_HOPS=2; check the proxy chain')
    vi.advanceTimersByTime(10 * 60_000)
    clientIp(new Headers(), 1)
    expect(warn).toHaveBeenCalledTimes(2)
  } finally {
    warn.mockRestore()
    vi.useRealTimers()
  }
})
