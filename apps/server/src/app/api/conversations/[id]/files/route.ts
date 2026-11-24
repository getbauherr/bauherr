import { readCapped } from '../../../../../core/attachments/body'
import { UploadRefused } from '../../../../../core/attachments/image'
import { checkedFile } from '../../../../../core/conversations/files'
import { FILE_MAX_BYTES } from '../../../../../core/conversations/limits'
import { storeFile } from '../../../../../core/conversations/store'
import { grantConversation } from '../../../../(app)/lib/conversation-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const nameOf = (req: Request): string => {
  const raw = req.headers.get('x-file-name')
  return (raw ? decodeURIComponent(raw) : 'file').slice(0, 200)
}

export const POST = async (req: Request, context: Context): Promise<Response> => {
  const granted = await grantConversation((await context.params).id)
  if (granted instanceof Response) return granted
  try {
    const bytes = await readCapped(req, FILE_MAX_BYTES)
    if (bytes === null) throw new UploadRefused('The file is larger than 10 MB: shrink it.', 413)
    const contentType = checkedFile(req.headers.get('content-type') ?? '', bytes)
    const file = { workspace: granted.workspace, conversationId: granted.id, name: nameOf(req), contentType, bytes }
    return Response.json(await storeFile(granted.payload, file), { status: 201 })
  } catch (error) {
    if (error instanceof UploadRefused) return Response.json({ error: error.message }, { status: error.status })
    throw error
  }
}
