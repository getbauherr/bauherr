import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import { createConversation } from '../../../core/conversations/store'
import { createDraft } from '../../../core/requests/store'
import { grantNewRequest } from '../../(app)/lib/conversation-access'
import { getPerson } from '../../(app)/lib/session'
import { unauthorized } from '../../(app)/lib/unauthorized'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const input = z.object({ workspace: z.number().optional(), product: z.number().int().positive() })

export const POST = async (req: Request): Promise<Response> => {
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const signedIn = await getPerson()
    return signedIn
      ? Response.json({ error: 'Send the product.' }, { status: 400 })
      : unauthorized()
  }
  const { product } = parsed.data
  const granted = await grantNewRequest(parsed.data.workspace, product)
  if (granted instanceof Response) return granted
  const { payload, workspace } = granted
  const found = await payload.db.drizzle.execute(
    sql`SELECT 1 FROM "products" WHERE "id" = ${product} AND "workspace_id" = ${workspace}`,
  )
  if (found.rows.length === 0) return new Response(null, { status: 404 })
  const person = await getPerson()
  const id = await payload.db.drizzle.transaction(async (tx) => {
    const db = { db: { drizzle: tx } }
    const conversationId = await createConversation(db, workspace, 'New request')
    await createDraft(db, { conversationId, workspace, product, createdBy: person?.email ?? 'unknown' })
    return conversationId
  })
  return Response.json({ id }, { status: 201 })
}
