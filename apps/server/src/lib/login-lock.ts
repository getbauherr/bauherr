import type { Payload } from 'payload'

/** Tail of the sign-ins queued per lowercased email. */
const queues = new Map<string, Promise<unknown>>()
/** Sign-ins queued or running per lowercased email. */
const waiting = new Map<string, number>()

/** At most this many sign-ins of one account wait or run at once; more are refused at once (`LoginBusy`). */
export const MAX_LOGIN_WAITERS = 5

/** Too many sign-ins of one account at once; shown to the user as the generic sign-in error. */
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

/** The password sign-in of the login action: Payload's login inside the per-account queue. Returns the token; throws on a wrong password (status 401) or `LoginBusy`. */
export const signInWithPassword = async (payload: Payload, email: string, password: string): Promise<string> => {
  const { token } = await withLoginLock(email, () => payload.login({ collection: 'bauherren', data: { email, password } }))
  if (!token) throw Object.assign(new Error('no token'), { status: 401 })
  return token
}
