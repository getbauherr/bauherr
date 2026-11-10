import { tenantsOf } from '../../../../../lib/actions'
import { actor } from '../../../../../lib/intake/api'
import { mediaBytes } from '../../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A stored screenshot, for members of the session's Workspace (and Admins). */
export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload, user, token } = a
  const m = (await payload.findByID({ collection: 'media', id: (await params).id, depth: 1, overrideAccess: true }).catch(() => null)) as Record<string, any> | null
  const ws = m?.session?.workspace ?? m?.workspace
  const allowed = token ? String(m?.session?.embedToken?.id ?? m?.session?.embedToken) === String(token.id) : user && (user.role === 'admin' || tenantsOf(user).map(String).includes(String(typeof ws === 'object' ? ws?.id : ws)))
  if (!m || !allowed) return Response.json({ error: 'not found' }, { status: 404 })
  return new Response(Buffer.from(await mediaBytes(payload, m)), {
    headers: { 'content-type': m.mime ?? m.mimeType, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'private, max-age=3600' },
  })
}
