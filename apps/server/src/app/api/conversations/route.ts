import { z } from 'zod'
import { createConversation } from '../../../core/conversations/store'
import { grantWorkspace } from '../../(app)/lib/conversation-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const input = z.object({ workspace: z.number().optional(), title: z.string().trim().min(1).max(200) })

export const POST = async (req: Request): Promise<Response> => {
  const parsed = input.safeParse(await req.json().catch(() => null))
  const granted = await grantWorkspace(parsed.data?.workspace)
  if (granted instanceof Response) return granted
  if (!parsed.success) return Response.json({ error: 'Send a title.' }, { status: 400 })
  const id = await createConversation(granted.payload, granted.workspace, parsed.data.title)
  return Response.json({ id }, { status: 201 })
}
