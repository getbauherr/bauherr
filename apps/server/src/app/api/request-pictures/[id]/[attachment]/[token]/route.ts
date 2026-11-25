import { HTML_TYPE, MOCKUP_POLICY } from '../../../../../../core/attachments/image'
import { pictureTokenFits } from '../../../../../../core/requests/markdown'
import { readImage } from '../../../../../../core/views/attachments'
import { secret } from '../../../../../../lib/secrets'
import { payloadClient } from '../../../../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; attachment: string; token: string }> }

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const { id, attachment, token } = await context.params
  const recordId = Number(id)
  const attachmentId = Number(attachment)
  if (!Number.isInteger(recordId) || !Number.isInteger(attachmentId)) return new Response(null, { status: 404 })
  if (!pictureTokenFits(secret('PAYLOAD_SECRET'), recordId, attachmentId, token)) {
    return new Response(null, { status: 404 })
  }
  const image = await readImage(await payloadClient(), attachmentId)
  if (!image || image.record !== recordId) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        image.contentType === HTML_TYPE ? MOCKUP_POLICY : "sandbox; default-src 'none'; img-src 'self'",
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
