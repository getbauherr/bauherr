import { sql } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'
import { hasSessions } from '../lib/db-session'

const AMBIENT_LOCK = 143
const ACCOUNT_LOCK = 144

type Executor = Pick<Payload['db']['drizzle'], 'execute'>

const executorOf = async (req: PayloadRequest): Promise<Executor> => {
  const db = req.payload.db
  const session = req.transactionID && hasSessions(db) ? db.sessions[await req.transactionID]?.db : undefined
  return session ?? db.drizzle
}

export const lockAmbient = async (req: PayloadRequest, key = AMBIENT_LOCK): Promise<void> => {
  await (await executorOf(req)).execute(sql`select pg_advisory_xact_lock(${key})`)
}

export const lockAccount = async (req: PayloadRequest, id: number | string): Promise<void> => {
  await (await executorOf(req)).execute(sql`select pg_advisory_xact_lock(${ACCOUNT_LOCK}, ${Number(id)})`)
}
