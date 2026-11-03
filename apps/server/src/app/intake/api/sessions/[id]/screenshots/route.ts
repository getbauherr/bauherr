import { exclusive } from '../../../../../../lib/actions'
import { actor, ownSession } from '../../../../../../lib/intake/api'
import { MediaRejected, mediaLimits, readUpload, saveMedia } from '../../../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** Stores one screenshot of an open session. Multipart field `file`: png, jpeg or webp within `mediaLimits()` (default 5 MB, 5 per session). Answers `{ id }`. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload } = a
  const sessionId = (await params).id
  const { maxPerSession } = mediaLimits()
  const first = await ownSession(payload, a, sessionId)
  if (!first || first.status !== 'open') return fail('session not found', 404)
  const up = await readUpload(req)
  if (up instanceof Response) return up
  return exclusive(`intake:${sessionId}`, async () => {
    const s = await ownSession(payload, a, sessionId)
    if (!s || s.status !== 'open') return fail('session not found', 404)
    if ((s.screenshots ?? 0) >= maxPerSession) return fail(`at most ${maxPerSession} screenshots per session`, 409)
    let m
    try {
      m = await saveMedia(payload, { bytes: up.bytes, name: up.name, workspace: typeof s.workspace === 'object' ? s.workspace.id : s.workspace, session: s.id })
    } catch (e) {
      if (e instanceof MediaRejected) return fail(e.message, 415)
      throw e
    }
    await payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: (s.screenshots ?? 0) + 1 }, overrideAccess: true })
    return Response.json({ id: m.id }, { status: 201 })
  })
}
