import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { scope, STUCK_SQL } from './sql'

export const waitingOnOwner = async (payload: Payload, workspace: number): Promise<number> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT count(*) AS n FROM "records" r
    WHERE ${scope(workspace, undefined)} AND r."parked" IS NULL AND r."waiting_on" <> 'nobody'
      AND (r."waiting_on" = 'owner' OR ${STUCK_SQL})`)
  return z.object({ n: z.coerce.number() }).parse(result.rows[0]).n
}
