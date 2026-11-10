import { CommentRefused, uploadCommentMedia } from '../../../../../lib/actions'
import { actor } from '../../../../../lib/intake/api'
import { MediaRejected, readUpload } from '../../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** Stores one image for a comment on a Ticket of the caller's Workspace. Multipart field `file`; same limits as the screenshots endpoint. Answers `{ id }`. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  if (!a.user) return fail('forbidden', 403)
  const ticket = (await params).id
  if (!/^\d+$/.test(ticket)) return fail('ticket not found', 404)
  const up = await readUpload(req)
  if (up instanceof Response) return up
  try {
    return Response.json(await uploadCommentMedia(a.payload, a.user, { ticket, ...up }), { status: 201 })
  } catch (e) {
    if (e instanceof MediaRejected) return fail(e.message, 415)
    if (e instanceof CommentRefused) return fail(e.message, 409)
    if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 403) return fail('ticket not found', 404)
    throw e
  }
}
