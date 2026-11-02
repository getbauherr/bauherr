import { exclusive } from '../../../../../../lib/actions'
import { nextTurn, type Session } from '../../../../../../lib/intake/engine'
import { actor, modelFor, ownSession } from '../../../../../../lib/intake/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** One interview turn. Body: `{ text }`. Answers as an SSE stream: `turn` (question, options, draft, readiness) or `error`. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload, user } = a
  const id = (await params).id
  const first = await ownSession(payload, user, id)
  if (!first || first.status !== 'open') return Response.json({ error: 'session not found' }, { status: 404 })
  const { text } = (await req.json().catch(() => ({}))) as { text?: unknown }
  if (typeof text !== 'string') return Response.json({ error: 'text required' }, { status: 400 })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  const stream = new ReadableStream({
    async start(c) {
      try {
        await exclusive(`intake:${id}`, async () => {
          const s = await ownSession(payload, user, id)
          if (!s || s.status !== 'open') throw new Error('session not found')
          const state: Session = { messages: s.messages ?? [], draft: s.draft ?? null, screenshots: s.screenshots }
          const { session, turn, ready, exhausted, missing } = await nextTurn(state, text, await modelFor(payload, s))
          await payload.update({ collection: 'intake_sessions', id: s.id, data: { messages: session.messages, draft: session.draft }, overrideAccess: true })
          c.enqueue(event('turn', { question: turn.question, options: turn.options, draft: turn.draft, ready, exhausted, missing }))
        })
      } catch (e) {
        c.enqueue(event('error', { message: e instanceof Error ? e.message : String(e) }))
      }
      c.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}
