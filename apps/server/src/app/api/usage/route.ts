import config from '@payload-config'
import { getPayload } from 'payload'
import { resolveAgentKey } from '../../../lib/api-key'
import { reportDelta } from '../../../lib/cost'
import { ACCOUNT_LOCKED } from '../../../lib/oidc-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Usage hook endpoint: `Authorization: Bearer bha_...` (the session's agent key) and the cumulative per-model totals of one Claude Code session.
 * Body: `{ claudeSession, firstAt?, clientKey?, models: { [model]: [input, output, cacheRead, cacheWrite] } }`. Stores the delta since the last report on the Run the session holds (`lib/cost.ts`).
 */
export const POST = async (req: Request): Promise<Response> => {
  const token = /^Bearer\s+(bha_.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  const payload = await getPayload({ config })
  let agent: Awaited<ReturnType<typeof resolveAgentKey>> = null
  try {
    agent = token ? await resolveAgentKey(payload, token) : null
  } catch (e) {
    if (!(e instanceof Error) || e.message !== ACCOUNT_LOCKED) throw e
  }
  if (!agent) return Response.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const body = (await req.json()) as Parameters<typeof reportDelta>[2]
    return Response.json(await reportDelta(payload, { owner: agent.owner.id, keyId: agent.keyId }, body))
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
