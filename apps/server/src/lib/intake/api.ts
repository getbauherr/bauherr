import config from '@payload-config'
import { getPayload, type Payload } from 'payload'
import { tenantsOf } from '../actions'
import { decrypt } from '../secrets'
import { DEFAULT_MODEL_BY_TIER } from '../gateway'
import { gatewayModel, type ModelCall } from './engine'

export const SESSIONS_PER_IP_HOUR = 20

type Doc = Record<string, any>
const ws = (d: Doc) => (typeof d.workspace === 'object' ? d.workspace.id : d.workspace)

/** The signed-in Bauherr, or a 401 Response. */
export const actor = async (req: Request): Promise<{ payload: Payload; user: Doc } | Response> => {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: req.headers })
  return user ? { payload, user } : Response.json({ error: 'unauthorized' }, { status: 401 })
}

/** The open session of this Bauherr's Workspaces; 404 for anything else (no existence leak across Workspaces). */
export const ownSession = async (payload: Payload, user: Doc, sessionId: string): Promise<Doc | null> => {
  const s = (await payload.findByID({ collection: 'intake_sessions', id: sessionId, depth: 1, overrideAccess: true }).catch(() => null)) as Doc | null
  return s && (user.role === 'admin' || tenantsOf(user).map(String).includes(String(ws(s)))) ? s : null
}

/** Model call as the session's Workspace (standard tier, D5). */
export const modelFor = async (payload: Payload, session: Doc): Promise<ModelCall> => {
  const w = (await payload.findByID({ collection: 'workspaces', id: ws(session), depth: 0, overrideAccess: true })) as Doc
  const model = { ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }.standard
  return gatewayModel({ slug: w.slug, key: decrypt(w.gatewayKey), model })
}

export const ipOf = (req: Request): string => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
