import { resolveContext } from '../../../../../../lib/chat/context'
import { chatModelFor, runChat, type ChatInput } from '../../../../../../lib/chat/engine'
import { chatWho, fail, MAX_IMAGES, MAX_MESSAGE_CHARS, MAX_MESSAGES, ndjson, RUNS_PER_HOUR } from '../../../../../../lib/chat/http'
import { ownThread, recentRuns } from '../../../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The history as the client holds it, text and images only; null when it breaks a cap. */
const parse = (raw: unknown): ChatInput[] | null => {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_MESSAGES) return null
  const out: ChatInput[] = []
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || !Array.isArray(m.content)) return null
    const content: ChatInput['content'] = []
    for (const p of m.content) {
      if (p?.type === 'text' && typeof p.text === 'string') content.push({ type: 'text', text: p.text })
      else if (p?.type === 'image' && /^\d+$/.test(String(p.mediaId))) content.push({ type: 'image', mediaId: Number(p.mediaId) })
      else return null
    }
    if (content.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0) > MAX_MESSAGE_CHARS || content.filter((p) => p.type === 'image').length > MAX_IMAGES) return null
    out.push({ role: m.role, content })
  }
  return out.at(-1)!.role === 'user' ? out : null
}

/** Body `{ messages: [{ role, content: [{ type: 'text', text } | { type: 'image', mediaId }] }], context: { path } }`; streams the turn as NDJSON. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const thread = await ownThread(w, (await params).id)
  if (!thread) return fail('thread not found', 404)
  const body = (await req.json().catch(() => null)) as { messages?: unknown; context?: { path?: unknown } } | null
  const messages = parse(body?.messages)
  const path = body?.context?.path
  if (!messages || typeof path !== 'string' || !path.startsWith('/') || path.length > 500) return fail(`messages (at most ${MAX_MESSAGES}, the last from the user, text up to ${MAX_MESSAGE_CHARS} characters, up to 6 images each) and context.path required`, 400)
  const ids = [...new Set(messages.flatMap((m) => m.content.flatMap((p) => (p.type === 'image' ? [p.mediaId] : []))))]
  if (ids.length && (await w.payload.count({ collection: 'media', where: { and: [{ id: { in: ids } }, { workspace: { equals: w.workspace } }] }, overrideAccess: true })).totalDocs !== ids.length) return fail('image not found', 400)
  if ((await recentRuns(w)) >= RUNS_PER_HOUR) return fail('too many messages, try again later', 429)
  const context = { ...(await resolveContext(w.payload, w.user, w.workspace, { path })), path }
  return ndjson(runChat({ ...w, thread, messages, context, model: await chatModelFor(w.payload, w.workspace), signal: req.signal }))
}
