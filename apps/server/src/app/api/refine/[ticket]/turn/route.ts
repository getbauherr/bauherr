import { chatWho, fail } from '../../../../../lib/chat/http'
import { refineRecheck, refineTurn, type View } from '../../../../../lib/refine/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What the stream carries: the reply as far as written, then the whole panel state, or the reason the turn changed nothing. */
export type TurnEvent = { type: 'reply'; text: string } | { type: 'done'; view: View | null } | { type: 'error'; message: string }

/**
 * Body `{ text }` (a typed message) or `{ recheck: { point } }` (the short turn after an option click); streams NDJSON `TurnEvent`s. Bauherr/Admin only.
 * A client abort aborts the model call; nothing is stored then, nor when the result is invalid.
 */
export const POST = async (req: Request, { params }: { params: Promise<{ ticket: string }> }): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const ticket = Number((await params).ticket)
  const body = (await req.json().catch(() => null)) as { text?: unknown; recheck?: { point?: unknown } } | null
  const text = typeof body?.text === 'string' ? body.text : null
  const point = typeof body?.recheck?.point === 'string' ? body.recheck.point : null
  if (!Number.isInteger(ticket) || (text === null) === (point === null)) return fail('a Ticket id and either text or recheck.point required', 400)
  const enc = new TextEncoder()
  const abort = new AbortController()
  req.signal.addEventListener('abort', () => abort.abort())
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(c) {
        const send = (e: TurnEvent) => {
          if (!abort.signal.aborted) c.enqueue(enc.encode(`${JSON.stringify(e)}\n`))
        }
        const run = { ticket, workspaceId: w.workspace, signal: abort.signal }
        try {
          send({ type: 'done', view: await (text !== null ? refineTurn(w.payload, w.user, { ...run, text, onReply: (t) => send({ type: 'reply', text: t }) }) : refineRecheck(w.payload, w.user, { ...run, point: point! })) })
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
