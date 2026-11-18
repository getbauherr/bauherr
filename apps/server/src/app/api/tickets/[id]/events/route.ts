import { cursorOf, liveTicket, milestonesAfter } from '../../../../(app)/lib/ticket-live'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const POLL_MS = 2000
const HEARTBEAT_MS = 15000

export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const t = await liveTicket((await params).id)
  if (t instanceof Response) return t
  const enc = new TextEncoder()
  let cursor = req.headers.get('last-event-id') || cursorOf({ at: Date.now(), kind: '', id: 0 })
  let timers: ReturnType<typeof setInterval>[] = []
  const stop = () => timers.forEach(clearInterval)
  let ended = false
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      let busy = false
      const end = () => {
        if (ended) return
        ended = true
        stop()
        c.close()
      }
      const send = (s: string) => c.enqueue(enc.encode(s))
      const tick = async () => {
        if (busy) return
        busy = true
        try {
          for (const m of await milestonesAfter(t.payload, t.id, cursor)) {
            cursor = m.cursor
            send(`id: ${m.cursor}\nevent: milestone\ndata: ${JSON.stringify(m.milestone)}\n\n`)
          }
        } catch {
          end()
        } finally {
          busy = false
        }
      }
      timers = [setInterval(tick, POLL_MS), setInterval(() => send(': heartbeat\n\n'), HEARTBEAT_MS)]
      req.signal.addEventListener('abort', end)
      send(': connected\n\n')
    },
    cancel() {
      ended = true
      stop()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', connection: 'keep-alive' } })
}
