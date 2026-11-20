import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

const row = z.object({ id: z.coerce.number(), name: z.string() })

export const gitConnections = async (payload: Payload, workspace: number): Promise<{ id: number; name: string }[]> => {
  const result = await payload.db.drizzle.execute(sql`
    SELECT "id", "name" FROM "connections"
    WHERE "workspace_id" = ${workspace} AND "kind" IN ('github', 'gitlab') ORDER BY "id"`)
  return result.rows.map((r) => row.parse(r))
}
