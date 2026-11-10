import { chatWho, fail } from '../../../../lib/chat/http'
import { MediaRejected, mediaUrl, readUpload, saveMedia, type ImageMime } from '../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Stores one pasted or dropped image of the current Workspace. Multipart field `file`: png, jpeg or webp within `mediaLimits()`. Answers `{ id, url }`; send `id` as `{ type: 'image', mediaId }` in a run. */
export const POST = async (req: Request): Promise<Response> => {
  const w = await chatWho(req)
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
