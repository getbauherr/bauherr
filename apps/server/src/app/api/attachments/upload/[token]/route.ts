import { readCapped } from '../../../../../core/attachments/body'
import { IMAGE_MAX_BYTES, UploadRefused } from '../../../../../core/attachments/image'
import { checkUpload, receiveUpload } from '../../../../../core/attachments/store'
import { payloadClient } from '../../../../(app)/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ token: string }> }

const receive = async (req: Request, token: string): Promise<Response> => {
  const payload = await payloadClient()
  const now = new Date()
  await checkUpload(payload, token, now)
  const bytes = await readCapped(req, IMAGE_MAX_BYTES)
  if (bytes === null) throw new UploadRefused('The image is larger than 2 MB: shrink it.', 413)
  if (bytes.length === 0) throw new UploadRefused('The request has no body: send the file with --data-binary.', 400)
  return Response.json(await receiveUpload(payload, token, bytes, now), { status: 201 })
}

export const PUT = async (req: Request, context: Context): Promise<Response> => {
  try {
    return await receive(req, (await context.params).token)
  } catch (error) {
    if (error instanceof UploadRefused) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}
