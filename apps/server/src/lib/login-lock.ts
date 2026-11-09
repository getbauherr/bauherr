/** Tail of the sign-ins queued per lowercased email. */
const queues = new Map<string, Promise<unknown>>()

/**
 * Serialises password sign-ins per account: Payload reads the user before writing its whole `sessions` array, so parallel logins would drop one session.
 * An in-process queue, not a database lock: a waiter holds no pooled connection, so neither many sign-ins of one account nor Payload's
 * out-of-transaction write on a wrong password (`incrementLoginAttempts`) can exhaust the pool. It serialises within one server process,
 * which is today's deployment (one app container); several replicas would need a shared lock that holds no connection while it waits.
 */
export const withLoginLock = async <T>(email: string, fn: () => Promise<T>): Promise<T> => {
  const key = email.trim().toLowerCase()
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
  }
}
