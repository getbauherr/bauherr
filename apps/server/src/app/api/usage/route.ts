import config from '@payload-config'
import { getPayload } from 'payload'
import { resolveAgentKey } from '../../../lib/api-key'
import { reportDelta } from '../../../lib/cost'
import { ACCOUNT_LOCKED } from '../../../lib/oidc-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
