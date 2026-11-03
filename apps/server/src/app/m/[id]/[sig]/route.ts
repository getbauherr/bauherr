import config from '@payload-config'
import { getPayload } from 'payload'
import { mediaBytes, verifyMediaSig } from '../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const notFound = () => Response.json({ error: 'not found' }, { status: 404 })

/** Public image link `/m/<id>/<sig>.<ext>` (HMAC of the id; no login, no cookies). Embedded in forge Ticket bodies, so it must work without a Bauherr session. */
export const GET = async (_req: Request, { params }: { params: Promise<{ id: string; sig: string }> }): Promise<Response> => {
  const { id, sig } = await params
  if (!/^\d+$/.test(id) || !verifyMediaSig(id, sig)) return notFound()
  const payload = await getPayload({ config })
  const m = (await payload.findByID({ collection: 'media', id, depth: 0, overrideAccess: true }).catch(() => null)) as Record<string, any> | null
  if (!m) return notFound()
  return new Response(Buffer.from(await mediaBytes(payload, m)), {
    headers: { 'content-type': m.mime ?? m.mimeType, 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'public, max-age=31536000, immutable' },
  })
}
