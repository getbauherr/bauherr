import { resolveContext } from '../../../../lib/chat/context'
import { chatWho } from '../../../../lib/chat/http'
import { createThread, listThreads } from '../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Own, non-archived threads of the current Workspace, latest 200 by last message (`?archived=1`: the archived ones). */
export const GET = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  return Response.json({ threads: await listThreads(w, { archived: new URL(req.url).searchParams.get('archived') === '1' }) })
}

/** Body `{ path? }`: the page the thread starts on. */
export const POST = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const { path } = (await req.json().catch(() => ({}))) as { path?: unknown }
  const page = typeof path === 'string' && path.startsWith('/') && path.length <= 500 ? { path, label: (await resolveContext(w.payload, w.user, w.workspace, { path })).label } : undefined
  return Response.json(await createThread(w, page), { status: 201 })
}
