import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

/** First line of a Step summary, trimmed to the width the status words show. */
export const firstLine = (s: string | null | undefined): string => s?.split('\n')[0]?.trim().slice(0, 140) ?? ''

/** The agent's words of a Run whose latest Step is `waiting_ci`; null when the latest Step is anything else. One DB query, no forge call. */
export const waitingStepOf = async (payload: Payload, run: number | string): Promise<string | null> => {
  const row = (await payload.db.drizzle.execute(sql`SELECT "state"::text AS "state", "summary" FROM "steps" WHERE "run_id" = ${run} ORDER BY "seq" DESC, "id" DESC LIMIT 1`)).rows[0] as { state: string | null; summary: string | null } | undefined
  return row?.state === 'waiting_ci' ? firstLine(row.summary) : null
}
