import config from '@payload-config'
import { getPayload, type Payload } from 'payload'
import { loadWorkflows } from '../factory'
import { tenantsOf } from '../actions'
import { isBauherr } from '../people'
import { decrypt } from '../secrets'
import { DEFAULT_MODEL_BY_TIER } from '../gateway'
import { gatewayModel, type ModelCall } from './engine'
import { embedAuth } from './embed'
import { fakeModelAs } from './fake'

/** Per-user cap; there is no trusted-proxy config (X-Forwarded-For is client-controlled), so no per-IP cap exists. */
export const SESSIONS_PER_USER_HOUR = 20

type Doc = Record<string, any>
const ws = (d: Doc) => (typeof d.workspace === 'object' ? d.workspace.id : d.workspace)

/** Who is calling: a signed-in Bauherr, or an embed token (Product widget). */
export type Who = { user: Doc | null; token: Doc | null }

/** The caller (Bauherr session/API key, or `Authorization: Bearer bemb_...`), or a 401/403 Response. */
export const actor = async (req: Request): Promise<({ payload: Payload } & Who) | Response> => {
  const payload = await getPayload({ config })
  await loadWorkflows(payload)
  const token = await embedAuth(payload, req)
  if (token instanceof Response) return token
  if (token) return { payload, user: null, token }
  const { user } = await payload.auth({ headers: req.headers })
  if (user && !isBauherr(user)) return Response.json({ error: 'forbidden' }, { status: 403 })
  return user ? { payload, user, token: null } : Response.json({ error: 'unauthorized' }, { status: 401 })
}

/** The signed-in person of any role (a Product owner too) or an embed token, for the few routes that serve files to both; the caller decides what each may see. */
export const viewer = async (req: Request): Promise<({ payload: Payload } & Who) | Response> => {
  const payload = await getPayload({ config })
  await loadWorkflows(payload)
  const token = await embedAuth(payload, req)
  if (token instanceof Response) return token
  if (token) return { payload, user: null, token }
  const { user } = await payload.auth({ headers: req.headers })
  return user ? { payload, user, token: null } : Response.json({ error: 'unauthorized' }, { status: 401 })
}

const idOf = (v: unknown): unknown => (v && typeof v === 'object' ? (v as Doc).id : v)

/** The session this caller created (an Admin: any; a token: sessions of that token); 404 for anything else (no existence leak across Workspaces, members or tokens). */
export const ownSession = async (payload: Payload, { user, token }: Who, sessionId: string): Promise<Doc | null> => {
  const s = (await payload.findByID({ collection: 'intake_sessions', id: sessionId, depth: 1, overrideAccess: true }).catch(() => null)) as Doc | null
  if (!s) return null
  if (token) return String(idOf(s.embedToken)) === String(token.id) ? s : null
  return user && (user.role === 'admin' || (String(idOf(s.user)) === String(user.id) && tenantsOf(user).map(String).includes(String(ws(s))))) ? s : null
}

/** Model call as the session's Workspace (standard tier, D5). */
export const modelFor = async (payload: Payload, session: Doc): Promise<ModelCall> => {
  const w = (await payload.findByID({ collection: 'workspaces', id: ws(session), depth: 0, overrideAccess: true })) as Doc
  const model = { ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }.standard
  if (process.env.INTAKE_FAKE === '1' || process.env.CHAT_FAKE === '1') return fakeModelAs(model)
  return gatewayModel({ slug: w.slug, key: decrypt(w.gatewayKey), model })
}
