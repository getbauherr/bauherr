import { resolveContext } from '../../../../../../lib/chat/context'
import { chatModelFor, resumeChat } from '../../../../../../lib/chat/engine'
import { chatWho, fail, ndjson } from '../../../../../../lib/chat/http'
import { ownThread } from '../../../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Body `{ toolCallId, approved, reason? }`: the person's answer to the card; continues the turn as NDJSON. 409 when nothing matching awaits confirmation (wrong id or already answered). */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const thread = await ownThread(w, (await params).id)
  if (!thread) return fail('thread not found', 404)
  const b = (await req.json().catch(() => null)) as { toolCallId?: unknown; approved?: unknown; reason?: unknown } | null
  if (!b || typeof b.toolCallId !== 'string' || typeof b.approved !== 'boolean' || (b.reason !== undefined && typeof b.reason !== 'string')) return fail('toolCallId (string), approved (boolean) and reason (string) only', 400)
  const context = await resolveContext(w.payload, w.user, w.workspace, { path: thread.context?.path ?? '/' })
  const stream = await resumeChat({ ...w, thread, toolCallId: b.toolCallId, approved: b.approved, reason: b.reason as string | undefined, context, model: await chatModelFor(w.payload, w.workspace), signal: req.signal })
  return stream ? ndjson(stream) : fail('nothing to confirm', 409)
}
