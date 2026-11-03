import { exclusive } from '../../../../../../lib/actions'
import { nextTurn, type Session } from '../../../../../../lib/intake/engine'
import { MAX_IMAGES_PER_SESSION } from '../../../../../../lib/intake/media'
import { actor, modelFor, ownSession } from '../../../../../../lib/intake/api'
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
  if (!Array.isArray(images) || images.length > MAX_IMAGES_PER_SESSION) return Response.json({ error: 'images must be a list of screenshot ids' }, { status: 400 })
  const event = (name: string, data: unknown) => new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
  const stream = new ReadableStream({
    async start(c) {
      try {
        await exclusive(`intake:${id}`, async () => {
          const s = await ownSession(payload, a, id)
          if (!s || s.status !== 'open') throw new Error('session not found')
          const state: Session = { messages: s.messages ?? [], draft: s.draft ?? null, split: s.split ?? undefined, screenshots: s.screenshots }
          const sent = new Set(state.messages.flatMap((m) => m.images ?? []).map(String))
          const found = images.length ? (await payload.find({ collection: 'media', where: { and: [{ session: { equals: s.id } }, { id: { in: images } }] }, pagination: false, depth: 0, overrideAccess: true })).docs : []
          if (found.length !== new Set(images.map(String)).size || found.some((m) => sent.has(String(m.id)))) throw new Error('unknown or already sent screenshot')
          const { session, turn, ready, exhausted, missing } = await nextTurn(state, text, await modelFor(payload, s), found.map((m) => ({ id: m.id, mime: m.mime, data: m.data })))
          const out = { question: turn.question, options: turn.options, draft: turn.draft, split: turn.split, ready, exhausted, missing }
          await payload.update({ collection: 'intake_sessions', id: s.id, data: { messages: session.messages, draft: session.draft, split: session.split ?? null, turn: out }, overrideAccess: true })
          c.enqueue(event('turn', out))
        })
      } catch (e) {
        c.enqueue(event('error', { message: e instanceof Error ? e.message : String(e) }))
      }
      c.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
})
