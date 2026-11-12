import { tenantsOf } from '../../../../../../lib/actions'
import { artifactFile } from '../../../../../../lib/artifacts'
import { viewer } from '../../../../../../lib/intake/api'
import { canSeeProduct, isBauherr, isProductOwner } from '../../../../../../lib/people'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (error: string, status: number) => Response.json({ error }, { status })
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/webm': 'webm', 'video/mp4': 'mp4' }
const SAFE = { 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'", 'cache-control': 'private, max-age=3600' }

/** The file or text of one review artifact, for a signed-in member of the Ticket's Workspace (and Admins) and a Product owner assigned to the Ticket's Product; 404 for anything else. Images and recordings are served inline under their sniffed type, text as an attachment; there is no public link. */
export const GET = async (req: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }): Promise<Response> => {
  const a = await viewer(req)
  if (a instanceof Response) return a
  if (!a.user) return fail('forbidden', 403)
  const { id, artifactId } = await params
  if (!/^\d+$/.test(id) || !/^\d+$/.test(artifactId)) return fail('not found', 404)
  const art = (await a.payload.findByID({ collection: 'artifacts', id: artifactId, depth: 0, overrideAccess: true }).catch(() => null)) as Record<string, any> | null
  const ws = String(typeof art?.workspace === 'object' ? art.workspace?.id : art?.workspace)
  if (!art || String(typeof art.ticket === 'object' ? art.ticket?.id : art.ticket) !== id) return fail('not found', 404)
  if (isProductOwner(a.user)) {
    const t = (await a.payload.findByID({ collection: 'tickets', id, depth: 0, select: { product: true, workspace: true }, overrideAccess: true }).catch(() => null)) as Record<string, any> | null
    if (!t || !canSeeProduct(a.user, { id: t.product, workspace: t.workspace })) return fail('not found', 404)
  } else if (!isBauherr(a.user) || !(a.user.role === 'admin' || tenantsOf(a.user).map(String).includes(ws))) return fail('not found', 404)
  if (art.text && !art.media) return new Response(art.text, { headers: { ...SAFE, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="artifact-${art.id}.txt"` } })
  const file = await artifactFile(a.payload, art)
  if (!file) return fail('not found', 404)
  return new Response(Buffer.from(file.bytes), { headers: { ...SAFE, 'content-type': file.type, 'content-disposition': `${new URL(req.url).searchParams.has('download') ? 'attachment' : 'inline'}; filename="artifact-${art.id}.${EXT[file.type]}"` } })
}
