import { readFile } from '../../../../../../core/conversations/store'
import { grantConversation } from '../../../../../(app)/lib/conversation-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string; fileId: string }> }

export const GET = async (_req: Request, context: Context): Promise<Response> => {
  const { id, fileId } = await context.params
  const granted = await grantConversation(id, 'files')
  if (granted instanceof Response) return granted
  const file = await readFile(granted.payload, granted.id, Number(fileId))
  if (!file) return new Response(null, { status: 404 })
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.contentType,
      'Content-Length': String(file.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'",
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
