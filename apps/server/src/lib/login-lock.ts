import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

/** Serialises password sign-ins per account: Payload reads the user before its own transaction, so parallel logins would overwrite each other's session. */
export const withLoginLock = <T>(payload: Payload, email: string, fn: () => Promise<T>): Promise<T> =>
  payload.db.drizzle.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'login:' + email.trim().toLowerCase()}))`)
    return fn()
  })
