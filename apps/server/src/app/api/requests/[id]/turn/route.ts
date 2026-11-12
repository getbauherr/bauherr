import { chatWho, fail } from '../../../../../lib/chat/http'
import { partialReply } from '../../../../../lib/chat/stream'
import { ownsRequest, requestTurn, type RequestView } from '../../../../../lib/request-conversation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What the stream carries: the reply as far as written, then the whole conversation state, or the reason the turn changed nothing. */
export type TurnEvent = { type: 'reply'; text: string } | { type: 'done'; view: RequestView | null } | { type: 'error'; message: string }

/**
 * Body `{ text, images? }` (`images`: ids from `api/requests/media`); streams NDJSON `TurnEvent`s. The author of an open request only: a Bauherr, an Admin or a Product owner of its Product.
 * A client abort aborts the model call; nothing is stored then, nor when the result is invalid.
 */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const w = await chatWho(req, { owner: true })
  if (w instanceof Response) return w
  const session = Number((await params).id)
  const body = (await req.json().catch(() => null)) as { text?: unknown; images?: unknown } | null
  const images = Array.isArray(body?.images) && body.images.every((i) => Number.isInteger(i)) ? (body.images as number[]) : []
  if (!Number.isInteger(session) || typeof body?.text !== 'string') return fail('a request id and text required', 400)
  if (!(await ownsRequest(w, session))) return fail('request not found', 404)
  const text = body.text
  const enc = new TextEncoder()
  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort())
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (e: TurnEvent) => {
          if (!abort.signal.aborted) c.enqueue(enc.encode(`${JSON.stringify(e)}\n`))
        }
        let shown = ''
        try {
          const view = await requestTurn(w, {
            session,
            text,
            images,
            signal: abort.signal,
            onPartial: (json) => {
              const t = partialReply(json, 'question')?.replace(/\s+/g, ' ').trimStart()
              if (t != null && t !== shown) send({ type: 'reply', text: (shown = t) })
            },
          })
          send({ type: 'done', view })
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : 'The turn failed.' })
        }
        if (!abort.signal.aborted) c.close()
      },
      cancel: () => abort.abort(),
    }),
    { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } },
  )
}
