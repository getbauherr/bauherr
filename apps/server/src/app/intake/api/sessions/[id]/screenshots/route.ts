import { exclusive } from '../../../../../../lib/actions'
import { actor, ownSession } from '../../../../../../lib/intake/api'
import { preflight, withCors } from '../../../../../../lib/intake/embed'
import { MediaRejected, mediaLimits, saveMedia } from '../../../../../../lib/intake/media'
import { tooBigMessage } from '../../../../../../lib/intake/media-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** Stores one screenshot of an open session. Multipart field `file`: png, jpeg or webp within `mediaLimits()` (default 5 MB, 5 per session). Answers `{ id }`. */
export const OPTIONS = preflight
export const POST = withCors(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload } = a
  const sessionId = (await params).id
  const { maxBytes, maxPerSession } = mediaLimits()
  const tooBig = tooBigMessage(maxBytes)
  const first = await ownSession(payload, a, sessionId)
  if (!first || first.status !== 'open') return fail('session not found', 404)
  const length = Number(req.headers.get('content-length'))
  if (!length) return fail('content-length required', 411)
  if (length > maxBytes + 64 * 1024) return fail(tooBig, 413)
  const file = (await req.formData().catch(() => null))?.get('file')
  if (!(file instanceof File)) return fail('file required', 400)
  if (file.size > maxBytes) return fail(tooBig, 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  return exclusive(`intake:${sessionId}`, async () => {
    const s = await ownSession(payload, a, sessionId)
    if (!s || s.status !== 'open') return fail('session not found', 404)
    if ((s.screenshots ?? 0) >= maxPerSession) return fail(`at most ${maxPerSession} screenshots per session`, 409)
    let m
    try {
      m = await saveMedia(payload, { bytes, name: file.name, workspace: typeof s.workspace === 'object' ? s.workspace.id : s.workspace, session: s.id })
    } catch (e) {
      if (e instanceof MediaRejected) return fail(e.message, 415)
      throw e
    }
    await payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: (s.screenshots ?? 0) + 1 }, overrideAccess: true })
    return Response.json({ id: m.id }, { status: 201 })
  })
})
