import { chatWho, fail } from '../../../../lib/chat/http'
import { MediaRejected, mediaUrl, readUpload, saveMedia, type ImageMime } from '../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Stores one pasted or dropped image of the current Workspace for a request conversation (the same as `api/chat/media`, open to a Product owner too). Multipart field `file`. Answers `{ id, url }`; send `id` in `images` of a turn. */
export const POST = async (req: Request): Promise<Response> => {
  const w = await chatWho(req, { owner: true })
  if (w instanceof Response) return w
  const up = await readUpload(req)
  if (up instanceof Response) return up
  try {
    const m = await saveMedia(w.payload, { ...up, workspace: w.workspace })
    return Response.json({ id: m.id, url: mediaUrl(m.id, m.mime as ImageMime) }, { status: 201 })
  } catch (e) {
    if (e instanceof MediaRejected) return fail(e.message, 415)
    throw e
  }
}
