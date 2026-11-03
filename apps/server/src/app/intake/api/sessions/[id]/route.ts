import { actor, ownSession } from '../../../../../lib/intake/api'
import { preflight, withCors } from '../../../../../lib/intake/embed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The session as persisted, so a client can resume it: status, messages, draft, split, last turn, screenshot count, created Ticket numbers. */
export const OPTIONS = preflight
const handle = withCors(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const s = await ownSession(a.payload, a, (await params).id)
  if (!s) return Response.json({ error: 'session not found' }, { status: 404 })
  return Response.json({ status: s.status, messages: s.messages ?? [], draft: s.draft ?? null, split: s.split ?? null, turn: s.turn ?? null, screenshots: s.screenshots ?? 0, ticketNumbers: s.ticketNumbers ?? (s.ticketNumber ? [s.ticketNumber] : []) })
})

/** The widget calls it as POST: browsers omit Origin on a same-origin GET, and an embed token is only accepted with its Origin. */
export const GET = handle
export const POST = handle
