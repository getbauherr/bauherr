import { tenantsOf } from '../../../../../lib/actions'
import { actor } from '../../../../../lib/intake/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A stored screenshot, for members of the session's Workspace (and Admins). */
export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload, user } = a
  const m = (await payload.findByID({ collection: 'media', id: (await params).id, depth: 1, overrideAccess: true }).catch(() => null)) as Record<string, any> | null
  const ws = m?.session?.workspace
  if (!m || (user.role !== 'admin' && !tenantsOf(user).map(String).includes(String(typeof ws === 'object' ? ws?.id : ws)))) return Response.json({ error: 'not found' }, { status: 404 })
  return new Response(Buffer.from(m.data, 'base64'), {
    headers: { 'content-type': m.mime, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'private, max-age=3600' },
  })
}
