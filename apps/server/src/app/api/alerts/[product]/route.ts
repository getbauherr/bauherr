import config from '@payload-config'
import { getPayload } from 'payload'
import { handleAlert } from '../../../../core/alerts/route'
import { createWriter } from '../../../../core/forge/writer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = async (req: Request, ctx: { params: Promise<{ product?: string }> }): Promise<Response> => {
  const payload = await getPayload({ config })
  const product = Number((await ctx.params).product)
  return handleAlert(payload, { writer: createWriter(payload) }, product, req, Date.now())
}
