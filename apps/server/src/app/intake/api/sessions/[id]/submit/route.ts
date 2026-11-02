import { submitIntake } from '../../../../../../lib/actions'
import { actor, ownSession } from '../../../../../../lib/intake/api'
import { preflight, withCors } from '../../../../../../lib/intake/embed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Creates the Ticket (at Triage) from a ready, or question-capped, session. */
export const OPTIONS = preflight
export const POST = withCors(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const a = await actor(req)
  if (a instanceof Response) return a
  const s = await ownSession(a.payload, a, (await params).id)
  if (!s) return Response.json({ error: 'session not found' }, { status: 404 })
  try {
    return Response.json(await submitIntake(a.payload, s.id))
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 })
  }
})
