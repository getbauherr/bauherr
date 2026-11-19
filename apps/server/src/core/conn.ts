import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

export type Conn = { db: { drizzle: Pick<Payload['db']['drizzle'], 'execute'> } }

export const inLockedRecord = <T>(payload: Payload, recordId: number, work: (tx: Conn) => Promise<T>): Promise<T> =>
  payload.db.drizzle.transaction(async (tx) => {
    await tx.execute(sql`SELECT "id" FROM "records" WHERE "id" = ${recordId} FOR UPDATE`)
    return work({ db: { drizzle: tx } })
  })
