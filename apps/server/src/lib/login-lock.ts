import { sql } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'

/**
 * Serialises password sign-ins per account: Payload reads the user before writing its session, so parallel logins would overwrite each other's session.
 * `fn` must run its Payload calls with the given `req`, so they share the locked transaction's single connection (no second pool connection, no pool deadlock).
 */
export const withLoginLock = async <T>(payload: Payload, email: string, fn: (req: PayloadRequest) => Promise<T>): Promise<T> => {
  const transactionID = await payload.db.beginTransaction()
  if (!transactionID) throw new Error('cannot begin login transaction')
  const req = await createLocalReq({}, payload)
  req.transactionID = transactionID
  try {
    await (payload.db as any).sessions[transactionID].db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'login:' + email.trim().toLowerCase()}))`)
    const result = await fn(req)
    await payload.db.commitTransaction(transactionID)
    return result
  } catch (e) {
    await payload.db.rollbackTransaction(transactionID)
    throw e
  }
}
