import { z } from 'zod'
import { UploadRefused } from '../../../../core/attachments/image'
import { appendMessage, listMessages } from '../../../../core/conversations/store'
import { grantConversation } from '../../../(app)/lib/conversation-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const input = z.object({ text: z.string(), fileIds: z.array(z.number().int().positive()).default([]) })

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const granted = await grantConversation((await context.params).id)
  if (granted instanceof Response) return granted
  return Response.json({ messages: await listMessages(granted.payload, granted.id) })
}

export const POST = async (req: Request, context: Context): Promise<Response> => {
  const granted = await grantConversation((await context.params).id)
  if (granted instanceof Response) return granted
  const parsed = input.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Send the text and the attached file ids.' }, { status: 400 })
  try {
    const message = { ...parsed.data, workspace: granted.workspace, conversationId: granted.id, role: 'user' as const }
    const id = await granted.payload.db.drizzle.transaction((tx) => appendMessage({ db: { drizzle: tx } }, message))
    return Response.json({ id }, { status: 201 })
  } catch (error) {
    if (error instanceof UploadRefused) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}
