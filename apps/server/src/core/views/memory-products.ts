import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export type MemoryProduct = { id: number; name: string; riskAreas: string[]; repo: string | null }

const productRow = z.object({
  id: z.coerce.number(),
  name: z.string(),
  risk_areas: z.array(z.string()).nullable(),
  repo: z.string().nullable(),
})

export const memoryProducts = async (payload: Payload, workspace: number): Promise<MemoryProduct[]> => {
  const found = await payload.db.drizzle.execute(sql`
    SELECT p."id", p."name", p."risk_areas",
      (SELECT s."repo" FROM "ticket_sources" s WHERE s."product_id" = p."id" ORDER BY s."id" LIMIT 1) AS repo
    FROM "products" p WHERE p."workspace_id" = ${workspace} ORDER BY p."name", p."id"`)
  return found.rows.map((raw) => {
    const row = productRow.parse(raw)
    return { id: row.id, name: row.name, riskAreas: row.risk_areas ?? [], repo: row.repo }
  })
}
