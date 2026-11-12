import { chatWho, fail } from '../../../../../../lib/chat/http'
import { loadMessages, upsertMessage } from '../../../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }

/** `{ context, ticket, pending, messages: [{ parentId, message, answer, feedback }] }`, oldest first. */
export const GET = async (req: Request, { params }: P): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const id = (await params).id
  const r = await loadMessages(w, id)
  return r ? Response.json(r) : fail('thread not found', 404)
}

/** Body `{ parentId?, message, answerId? }`: assistant-ui's exported message item, stored verbatim and upserted by `message.id`. */
export const PUT = async (req: Request, { params }: P): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const b = (await req.json().catch(() => null)) as { parentId?: string | null; message?: Record<string, any>; answerId?: string } | null
  if (!b?.message) return fail('message required', 400)
  try {
    return (await upsertMessage(w, (await params).id, { parentId: b.parentId, message: b.message, answerId: b.answerId })) ? new Response(null, { status: 204 }) : fail('thread not found', 404)
  } catch (e) {
    return fail((e as Error).message, 400)
  }
}
