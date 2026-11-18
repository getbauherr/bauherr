import { resolveContext } from '../../../../lib/chat/context'
import { chatWho, fail } from '../../../../lib/chat/http'
import { createThread, listThreads, ticketThread } from '../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  return Response.json({ threads: await listThreads(w, { archived: new URL(req.url).searchParams.get('archived') === '1' }) })
}

export const POST = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const { path, ticket } = (await req.json().catch(() => ({}))) as { path?: unknown; ticket?: unknown }
  if (ticket !== undefined) return (await ticketThread(w, String(ticket)).then((m) => m && Response.json(m))) ?? fail('ticket not found', 404)
  const page = typeof path === 'string' && path.startsWith('/') && path.length <= 500 ? { path, label: (await resolveContext(w.payload, w.user, w.workspace, { path })).label } : undefined
  return Response.json(await createThread(w, page), { status: 201 })
}
