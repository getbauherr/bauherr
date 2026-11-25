import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'
import { assignmentOf, isBauherr, isProductOwner, mayWorkIn } from '../../lib/people'

export type RequestScope = { workspace: number; product: number | null }

const scopeRow = z.object({ workspace_id: z.coerce.number(), product_id: z.coerce.number().nullable() })

export const requestScope = async (payload: Payload, recordId: number): Promise<RequestScope | null> => {
  const found = await payload.db.drizzle.execute(
    sql`SELECT "workspace_id", "product_id" FROM "records" WHERE "id" = ${recordId}`,
  )
  if (!found.rows[0]) return null
  const row = scopeRow.parse(found.rows[0])
  return { workspace: row.workspace_id, product: row.product_id }
}

export const mayOpenRequest = (person: object, scope: RequestScope): boolean => {
  if (isProductOwner(person)) {
    const assignment = assignmentOf(person, scope.workspace)
    if (assignment === null) return false
    return assignment.scope === 'workspace' || (scope.product !== null && assignment.products.includes(scope.product))
  }
  return isBauherr(person) && mayWorkIn(person, scope.workspace)
}
