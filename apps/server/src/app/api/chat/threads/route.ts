import { resolveContext } from '../../../../lib/chat/context'
import { chatWho, fail } from '../../../../lib/chat/http'
import { isProductOwner } from '../../../../lib/people'
import { newRequestThread, requestThread } from '../../../../lib/chat/request'
import { createThread, listThreads, meta, ticketThread } from '../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Own, non-archived threads of the current Workspace, latest 200 by last message (`?archived=1`: the archived ones). */
export const GET = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  return Response.json({ threads: await listThreads(w, { archived: new URL(req.url).searchParams.get('archived') === '1' }) })
}

/** Body `{ path? }`: the page the thread starts on; or `{ ticket }` (Ticket id): the person's one thread of that Ticket (created on first use, 404 for a Ticket of another Workspace), answered `200`; or `{ request: true }`: a thread for a new request (an empty one is reused; 404 when the Workspace has no Product); or `{ requestSession }`: the thread of one of the person's requests (404 for anyone else's). A Product owner has no other threads: anything without `ticket` or `requestSession` is a new request. */
export const POST = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const { path, ticket, request, requestSession } = (await req.json().catch(() => ({}))) as { path?: unknown; ticket?: unknown; request?: unknown; requestSession?: unknown }
  // A Product owner's chat is the request chat: a blank chat starts a new request.
  if (request === true || (isProductOwner(w.user) && requestSession === undefined && ticket === undefined)) return (await newRequestThread(w).then((t) => t && Response.json(meta(t)))) ?? fail('no product in this Workspace', 404)
  if (requestSession !== undefined) return (await requestThread(w, requestSession).then((t) => t && Response.json(meta(t)))) ?? fail('request not found', 404)
  if (ticket !== undefined) return (await ticketThread(w, String(ticket)).then((m) => m && Response.json(m))) ?? fail('ticket not found', 404)
  const page = typeof path === 'string' && path.startsWith('/') && path.length <= 500 ? { path, label: (await resolveContext(w.payload, w.user, w.workspace, { path })).label } : undefined
  return Response.json(await createThread(w, page), { status: 201 })
}
