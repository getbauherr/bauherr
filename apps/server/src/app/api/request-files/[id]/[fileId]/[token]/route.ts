import { conversationRecord, readFile } from '../../../../../../core/conversations/store'
import { tokenFits } from '../../../../../../core/requests/markdown'
import { loadDraft } from '../../../../../../core/requests/store'
import { secret } from '../../../../../../lib/secrets'
import { payloadClient } from '../../../../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; fileId: string; token: string }> }

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const { id, fileId, token } = await context.params
  const conversationId = Number(id)
  const file = Number(fileId)
  if (!Number.isInteger(conversationId) || !Number.isInteger(file)) return new Response(null, { status: 404 })
  if (!tokenFits(secret('PAYLOAD_SECRET'), conversationId, file, token)) return new Response(null, { status: 404 })
  const payload = await payloadClient()
  const sent = (await loadDraft(payload, conversationId))?.state === 'sent'
  if (!sent && (await conversationRecord(payload, conversationId)) === null) return new Response(null, { status: 404 })
  const found = await readFile(payload, conversationId, file)
  if (!found) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'Content-Type': found.contentType,
      'Content-Length': String(found.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'",
      'Content-Disposition': found.contentType.startsWith('image/') ? 'inline' : 'attachment',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
