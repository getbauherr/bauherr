import { chatWho, fail } from '../../../../../lib/chat/http'
import { deleteThread, listThreads, updateThread, ownThread } from '../../../../../lib/chat/threads'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type P = { params: Promise<{ id: string }> }
const NOT_FOUND = () => fail('thread not found', 404)

export const GET = async (req: Request, { params }: P): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const id = (await params).id
  const t = await ownThread(w, id)
  return t ? Response.json((await listThreads(w, { archived: !!t.archivedAt })).find((m) => m.id === t.id)) : NOT_FOUND()
}

/** Body `{ title?, archived? }`. */
export const PATCH = async (req: Request, { params }: P): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const b = (await req.json().catch(() => null)) as { title?: unknown; archived?: unknown } | null
  if (!b || (b.title !== undefined && b.title !== null && typeof b.title !== 'string') || (b.archived !== undefined && typeof b.archived !== 'boolean')) return fail('title (string) and archived (boolean) only', 400)
  const t = await updateThread(w, (await params).id, { title: b.title as string | null | undefined, archived: b.archived as boolean | undefined })
  return t ? Response.json(t) : NOT_FOUND()
}

export const DELETE = async (req: Request, { params }: P): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  return (await deleteThread(w, (await params).id)) ? new Response(null, { status: 204 }) : NOT_FOUND()
}
