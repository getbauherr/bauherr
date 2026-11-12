import type { Payload } from 'payload'
import { envInt } from './db-pool'

/** Tail of the sign-ins queued per lowercased email. */
const queues = new Map<string, Promise<unknown>>()
/** Sign-ins queued or running per lowercased email. */
const waiting = new Map<string, number>()

/** At most this many sign-ins of one account wait or run at once; more are refused at once (`LoginBusy`). */
export const MAX_LOGIN_WAITERS = 5

/** Sign-in limits from env, checked at boot (`payload.config.ts`): `LOGIN_IP_MAX_ATTEMPTS` failed sign-ins per client IP and `IP_WINDOW_MS` (default 10), `TRUSTED_PROXY_HOPS` proxies in front that append to `x-forwarded-for` (default 1; 0 = ignore the header, which turns the IP limit off). */
export const loginLimits = (env: Record<string, string | undefined> = process.env) => ({
  maxIpFailures: envInt(env, 'LOGIN_IP_MAX_ATTEMPTS', 10),
  trustedProxyHops: envInt(env, 'TRUSTED_PROXY_HOPS', 1, 0),
})
export const IP_WINDOW_MS = 60_000
const failures = new Map<string, { n: number; reset: number }>()

/** The shared IP key of requests that did not pass the configured proxy chain: omitting or forging `x-forwarded-for` gives no fresh budget. */
export const UNVERIFIED_IP = 'ip:unverified'
const WARN_EVERY_MS = 10 * 60_000
let warnedAt = -Infinity

/**
 * The client IP: the `hops`-th `x-forwarded-for` entry from the right, the one the outermost trusted proxy appended (entries left of it are client-supplied).
 * Fewer entries than `hops` (or no header): `UNVERIFIED_IP`, with a warning at most every 10 min. 0 hops: undefined, the IP limit is off (a Next request exposes no socket address).
 */
export const clientIp = (headers: Headers, hops = loginLimits().trustedProxyHops): string | undefined => {
  if (!hops) return undefined
  const parts = headers.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean) ?? []
  if (parts.length >= hops) return parts[parts.length - hops]
  if (Date.now() - warnedAt >= WARN_EVERY_MS) {
    warnedAt = Date.now()
    console.warn(`login IP key: request had ${parts.length} x-forwarded-for entries, TRUSTED_PROXY_HOPS=${hops}; check the proxy chain`)
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

/** Too many sign-ins of one account at once, or from one IP; shown to the user as the generic sign-in error. */
export class LoginBusy extends Error {
  constructor() {
    super('too many sign-ins of this account at once')
  }
}

/**
 * Serialises password sign-ins per account: Payload reads the user before writing its whole `sessions` array, so parallel logins would drop one session.
 * An in-process queue, not a database lock: a waiter holds no pooled connection, so neither many sign-ins of one account nor Payload's
 * out-of-transaction write on a wrong password (`incrementLoginAttempts`) can exhaust the pool. It serialises within one server process,
 * which is today's deployment (one app container); several replicas would need a shared lock that holds no connection while it waits.
 * Beyond `MAX_LOGIN_WAITERS` per account it throws `LoginBusy` before queueing, so a burst cannot build an unbounded queue.
 * Writers of an account (settings forms) run inside the same queue: a sign-in writes back the whole user it read at its start, so an edit made in between (role, tenants, GitHub login) would be reverted by it.
 */
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

/** The password sign-in of the login action and the REST `/api/bauherren/login`: the per-IP limit, then Payload's login inside the per-account queue. Only failed sign-ins (401) count toward the IP limit. Returns Payload's login result; throws on a wrong password (status 401) or `LoginBusy`. */
export const signInWithPassword = async (payload: Payload, email: string, password: string, ip?: string) => {
  if (ip && ipBlocked(ip)) throw new LoginBusy()
  try {
    const result = await withLoginLock(email, () => payload.login({ collection: 'bauherren', data: { email, password } }))
    if (!result.token) throw Object.assign(new Error('no token'), { status: 401 })
    return { ...result, token: result.token }
  } catch (e) {
    if (ip && (e as { status?: number }).status === 401) ipFailed(ip)
    throw e
  }
}
