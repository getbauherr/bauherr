import config from '@payload-config'
import { getPayload } from 'payload'
import { MAX_BODY_BYTES, receiveDelivery } from '../../../../core/hooks/receive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const readBounded = async (req: Request): Promise<Uint8Array | null> => {
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) return null
  if (!req.body) return new Uint8Array()
  const chunks: Uint8Array[] = []
  const reader = req.body.getReader()
  let size = 0
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.length
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(part.value)
  }
  return Buffer.concat(chunks)
}

export const POST = async (req: Request, ctx: { params: Promise<{ connection?: string }> }): Promise<Response> => {
  const raw = await readBounded(req)
  if (raw === null) return new Response(null, { status: 413 })
  const id = Number((await ctx.params).connection)
  if (!Number.isInteger(id) || id < 1) return new Response(null, { status: 401 })
  const status = await receiveDelivery(await getPayload({ config }), id, req.headers, raw, new Date())
  return new Response(null, { status })
}
