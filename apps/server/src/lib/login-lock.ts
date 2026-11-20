import type { Payload } from 'payload'
import { envInt } from './db-pool'

const queues = new Map<string, Promise<unknown>>()
const waiting = new Map<string, number>()

export const MAX_LOGIN_WAITERS = 5

export const loginLimits = (env: Record<string, string | undefined> = process.env) => ({
  maxIpFailures: envInt(env, 'LOGIN_IP_MAX_ATTEMPTS', 10),
  trustedProxyHops: envInt(env, 'TRUSTED_PROXY_HOPS', 1, 0),
})
export const IP_WINDOW_MS = 60_000
const failures = new Map<string, { n: number; reset: number }>()

export const UNVERIFIED_IP = 'ip:unverified'
const WARN_EVERY_MS = 10 * 60_000
let warnedAt = -Infinity

export const clientIp = (headers: Headers, hops = loginLimits().trustedProxyHops): string | undefined => {
  if (!hops) return undefined
  const parts =
    headers
      .get('x-forwarded-for')
      ?.split(',')
      .map((p) => p.trim())
      .filter(Boolean) ?? []
  if (parts.length >= hops) return parts[parts.length - hops]
  if (Date.now() - warnedAt >= WARN_EVERY_MS) {
    warnedAt = Date.now()
    console.warn(
      `login IP key: request had ${parts.length} x-forwarded-for entries, ` +
        `TRUSTED_PROXY_HOPS=${hops}; check the proxy chain`,
    )
  }
  return UNVERIFIED_IP
}

const ipBlocked = (ip: string): boolean => {
  const f = failures.get(ip)
  return !!f && f.reset > Date.now() && f.n >= loginLimits().maxIpFailures
}

const ipFailed = (ip: string) => {
  const now = Date.now()
  if (failures.size > 10_000) for (const [k, v] of failures) if (v.reset <= now) failures.delete(k)
  const f = failures.get(ip)
  if (f && f.reset > now) f.n++
  else failures.set(ip, { n: 1, reset: now + IP_WINDOW_MS })
}

export class LoginBusy extends Error {
  constructor() {
    super('too many sign-ins of this account at once')
  }
}

export const withLoginLock = async <T>(email: string, fn: () => Promise<T>): Promise<T> => {
  const key = email.trim().toLowerCase()
  const count = waiting.get(key) ?? 0
  if (count >= MAX_LOGIN_WAITERS) throw new LoginBusy()
  waiting.set(key, count + 1)
  const run = (queues.get(key) ?? Promise.resolve()).then(fn, fn)
  const tail = run.then(
    () => undefined,
    () => undefined,
  )
  queues.set(key, tail)
  try {
    return await run
  } finally {
    if (queues.get(key) === tail) queues.delete(key)
    const left = (waiting.get(key) ?? 1) - 1
    if (left > 0) waiting.set(key, left)
    else waiting.delete(key)
  }
}

export const signInWithPassword = async (payload: Payload, email: string, password: string, ip?: string) => {
  if (ip && ipBlocked(ip)) throw new LoginBusy()
  try {
    const result = await withLoginLock(email, () =>
      payload.login({ collection: 'bauherren', data: { email, password } }),
    )
    if (!result.token) throw Object.assign(new Error('no token'), { status: 401 })
    return { ...result, token: result.token }
  } catch (e) {
    if (ip && (e as { status?: number }).status === 401) ipFailed(ip)
    throw e
  }
}
