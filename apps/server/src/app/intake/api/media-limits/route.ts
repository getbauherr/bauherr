import { actor } from '../../../../lib/intake/api'
import { preflight, withCors } from '../../../../lib/intake/embed'
import { mediaLimits } from '../../../../lib/intake/media'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The upload limits `{ maxBytes, maxPerSession }` the composers pre-check against (POST so the embed CORS preflight covers it). */
export const OPTIONS = preflight
export const POST = withCors(async (req: Request): Promise<Response> => {
  const a = await actor(req)
  return a instanceof Response ? a : Response.json(mediaLimits())
})
