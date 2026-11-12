import { tenantsOf } from '../../../../../lib/actions'
import { viewer } from '../../../../../lib/intake/api'
import { isBauherr, isProductOwner, mediaVisibleTo } from '../../../../../lib/people'
import { mediaBytes } from '../../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A stored screenshot or comment image, for members of its Workspace (and Admins), the widget token of its session, and a Product owner when it belongs to a Product assigned to them (anything else is a 404). */
export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await viewer(req)
  if (a instanceof Response) return a
  const { payload, user, token } = a
  const m = (await payload.findByID({ collection: 'media', id: (await params).id, depth: 1, overrideAccess: true }).catch(() => null)) as Record<string, any> | null
  const ws = m?.session?.workspace ?? m?.workspace
  const allowed = token ? String(m?.session?.embedToken?.id ?? m?.session?.embedToken) === String(token.id) : user && (isProductOwner(user) ? !!m && mediaVisibleTo(user, m) : isBauherr(user) && (user.role === 'admin' || tenantsOf(user).map(String).includes(String(typeof ws === 'object' ? ws?.id : ws))))
  if (!m || !allowed) return Response.json({ error: 'not found' }, { status: 404 })
  return new Response(Buffer.from(await mediaBytes(payload, m)), {
    headers: { 'content-type': m.mime ?? m.mimeType, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'private, max-age=3600' },
  })
}
