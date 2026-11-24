import { z } from 'zod'
import { sql } from '@payloadcms/db-postgres'
import { createConversation } from '../../../core/conversations/store'
import { grantWorkspace } from '../../(app)/lib/conversation-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const input = z.object({ workspace: z.number().optional(), title: z.string().trim().min(1).max(200),
  recordId: z.number().int().positive().optional(),
})

export const POST = async (req: Request): Promise<Response> => {
  const parsed = input.safeParse(await req.json().catch(() => null))
  const granted = await grantWorkspace(parsed.data?.workspace)
  if (granted instanceof Response) return granted
  if (!parsed.success) return Response.json({ error: 'Send a title.' }, { status: 400 })
  const { recordId } = parsed.data
  if (recordId !== undefined) {
    const found = await granted.payload.db.drizzle.execute(
      sql`SELECT 1 FROM "records" WHERE "id" = ${recordId} AND "workspace_id" = ${granted.workspace}`,
    )
    if (found.rows.length === 0) return new Response(null, { status: 404 })
  }
  const id = await createConversation(granted.payload, granted.workspace, parsed.data.title, recordId ?? null)
  return Response.json({ id }, { status: 201 })
}
