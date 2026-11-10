import { resolveContext } from '../../../../lib/chat/context'
import { chatWho, fail } from '../../../../lib/chat/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** `?path=/tickets/12` -> `{ label, markdown }`: what the assistant knows about that page. */
export const GET = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
  if (w instanceof Response) return w
  const path = new URL(req.url).searchParams.get('path')
  if (!path?.startsWith('/') || path.length > 500) return fail('path must start with /', 400)
  const { label, markdown } = await resolveContext(w.payload, w.user, w.workspace, { path })
  return Response.json({ label, markdown })
}
