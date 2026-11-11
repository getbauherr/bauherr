import { mediaLimits } from '../../../../../../lib/intake/media'
import { actor, ownSession } from '../../../../../../lib/intake/api'
import { advanceIntake } from '../../../../../../lib/intake/turn'
import { preflight, withCors } from '../../../../../../lib/intake/embed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One interview turn. Body: `{ text, images? }` (`images`: ids of this session's uploaded screenshots not yet sent). Answers as an SSE stream: `turn` (question, options, draft, readiness) or `error`. */
export const OPTIONS = preflight
export const POST = withCors(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload } = a
  const id = (await params).id
  const first = await ownSession(payload, a, id)
  if (!first || first.status !== 'open') return Response.json({ error: 'session not found' }, { status: 404 })
  const { text, images = [] } = (await req.json().catch(() => ({}))) as { text?: unknown; images?: unknown }
  if (typeof text !== 'string') return Response.json({ error: 'text required' }, { status: 400 })
  if (!Array.isArray(images) || images.length > mediaLimits().maxPerSession) return Response.json({ error: 'images must be a list of screenshot ids' }, { status: 400 })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  const stream = new ReadableStream({
    async start(c) {
      try {
        c.enqueue(event('turn', await advanceIntake(payload, a, id, text, images)))
      } catch (e) {
        c.enqueue(event('error', { message: e instanceof Error ? e.message : String(e) }))
      }
      c.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
})
