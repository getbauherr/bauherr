import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { search as searchKnowledge } from '../../../lib/knowledge'
import { searchItems } from '../../mirror/search'
import { authorize } from '../leases'
import { defineTool, leaseToken, ownRun, runId } from './tool'

const productRow = z.object({ id: z.coerce.number(), slug: z.string() })

export const search = defineTool({
  name: 'search',
  description:
    'Searches the mirrored issues and pull requests and the knowledge store of the Product of your run. ' +
    'Returns the matching items and knowledge passages.',
  access: 'agent',
  input: z.strictObject({
    runId,
    leaseToken,
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  run: async (input, context) => {
    const { payload } = context.deps
    await ownRun(context, input.runId)
    const run = await authorize(payload, input.runId, input.leaseToken)
    const found = await payload.db.drizzle.execute(sql`
      SELECT p."id", p."slug" FROM "records" r JOIN "products" p ON p."id" = r."product_id"
      WHERE r."id" = ${run.recordId}`)
    const product = productRow.parse(found.rows[0])
    const filter = { workspace: context.workspace, product: product.id, query: input.query, limit: input.limit }
    return {
      items: await searchItems(payload, filter),
      knowledge: await searchKnowledge(payload, context.workspace, input.query, input.limit, product.slug),
    }
  },
})
