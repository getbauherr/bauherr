import { chatWho, fail } from '../../../../../../lib/chat/http'
import { setFeedback } from '../../../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Body `{ messageId, value: 'up' | 'down' | null, reasons?: string[], note?: string }`; null withdraws the rating. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const b = (await req.json().catch(() => null)) as { messageId?: unknown; value?: unknown; reasons?: unknown; note?: unknown } | null
  if (!b || typeof b.messageId !== 'string' || ![null, 'up', 'down'].includes(b.value as string | null) || (b.reasons !== undefined && !Array.isArray(b.reasons)) || (b.note !== undefined && typeof b.note !== 'string')) return fail('messageId, value (up, down or null), reasons[] and note only', 400)
  return (await setFeedback(w, (await params).id, { messageId: b.messageId, value: b.value as 'up' | 'down' | null, reasons: b.reasons as string[] | undefined, note: b.note as string | undefined })) ? new Response(null, { status: 204 }) : fail('answer not found', 404)
}
