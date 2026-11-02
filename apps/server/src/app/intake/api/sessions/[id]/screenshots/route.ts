import { exclusive } from '../../../../../../lib/actions'
import { actor, ownSession } from '../../../../../../lib/intake/api'
import { MAX_IMAGES_PER_SESSION, MAX_IMAGE_BYTES, sniff, stripMetadata } from '../../../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (error: string, status: number) => Response.json({ error }, { status })

/** Stores one screenshot of an open session. Multipart field `file`: png, jpeg or webp, <= 5 MB, <= 5 per session. Answers `{ id }`. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const { payload } = a
  const sessionId = (await params).id
  const first = await ownSession(payload, a, sessionId)
  if (!first || first.status !== 'open') return fail('session not found', 404)
  const length = Number(req.headers.get('content-length'))
  if (!length) return fail('content-length required', 411)
  if (length > MAX_IMAGE_BYTES + 64 * 1024) return fail('image larger than 5 MB', 413)
  const file = (await req.formData().catch(() => null))?.get('file')
  if (!(file instanceof File)) return fail('file required', 400)
  if (file.size > MAX_IMAGE_BYTES) return fail('image larger than 5 MB', 413)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniff(bytes)
  if (!mime) return fail('only png, jpeg or webp images', 415)
  let clean: Uint8Array
  try {
    clean = stripMetadata(bytes, mime)
  } catch {
    return fail('corrupt image', 415)
  }
  return exclusive(`intake:${sessionId}`, async () => {
    const s = await ownSession(payload, a, sessionId)
    if (!s || s.status !== 'open') return fail('session not found', 404)
    if ((s.screenshots ?? 0) >= MAX_IMAGES_PER_SESSION) return fail(`at most ${MAX_IMAGES_PER_SESSION} screenshots per session`, 409)
    const m = await payload.create({ collection: 'media', data: { session: s.id, workspace: typeof s.workspace === 'object' ? s.workspace.id : s.workspace, name: file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'screenshot', mime, data: Buffer.from(clean).toString('base64') }, overrideAccess: true })
    await payload.update({ collection: 'intake_sessions', id: s.id, data: { screenshots: (s.screenshots ?? 0) + 1 }, overrideAccess: true })
    return Response.json({ id: m.id }, { status: 201 })
  })
}
