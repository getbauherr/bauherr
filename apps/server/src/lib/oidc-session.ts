import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuthStrategy, Payload } from 'payload'
import { secret } from './secrets'

export const SESSION_COOKIE = 'bauherr-session'
export const SESSION_TTL_S = 14 * 86400

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (body: string, key: string) => createHmac('sha256', key).update(body).digest()

/** HS256 JWT `{ id, v, typ, aud, exp }` signed with PAYLOAD_SECRET; `v` is the Bauherr's sessionVersion. */
export const signSession = (id: number | string, v: number, key = secret('PAYLOAD_SECRET'), now = Date.now()): string => {
  const body = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ id, v, typ: 'bauherr-session', aud: 'bauherr', exp: Math.floor(now / 1000) + SESSION_TTL_S }))}`
  return `${body}.${b64(mac(body, key))}`
}

export const verifySession = (token: string, key = secret('PAYLOAD_SECRET'), now = Date.now()): { id: number | string; v: number } | null => {
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return null
  const want = mac(`${h}.${p}`, key)
  const got = Buffer.from(s, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const { id, v, exp, typ, aud } = JSON.parse(Buffer.from(p, 'base64url').toString())
    return typ === 'bauherr-session' && aud === 'bauherr' && typeof v === 'number' && typeof exp === 'number' && exp * 1000 > now ? { id, v } : null
  } catch {
    return null
  }
}

export const isLocked = (lockUntil?: string | null): boolean => !!lockUntil && new Date(lockUntil).getTime() > Date.now()

export const ACCOUNT_LOCKED = 'This account is locked.'

/** Request headers whose API-key lookup hit a locked account; lets the caller of `payload.auth` tell a lock from an unknown key. */
export const lockedRequests = new WeakSet<Headers>()

/** Whether the request carries a credential Payload's built-in strategies resolve through `findByID`: API key, `JWT`/`Bearer` header or `payload-token` cookie. */
export const carriesPayloadCredential = (headers?: Headers | null): boolean =>
  /^(bauherren API-Key|JWT|Bearer) /.test(headers?.get?.('authorization') ?? '') || /(^|;\s*)payload-token=/.test(headers?.get?.('cookie') ?? '')

/** Whether the Bauherr is locked. `lockUntil` is hidden: it is read alone so hash/salt never reach callers. A failed read fails closed. */
export const accountLocked = async (payload: Payload, id: number | string): Promise<boolean> => {
  const lock = await payload.findByID({ collection: 'bauherren', id, depth: 0, overrideAccess: true, showHiddenFields: true, select: { lockUntil: true } }).catch(() => null)
  return !lock || isLocked(lock.lockUntil as string | null | undefined)
}

export const oidcStrategy: AuthStrategy = {
  name: 'oidc',
  authenticate: async ({ payload, headers }) => {
    const token = headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1)
    const session = token ? verifySession(token) : null
    if (!session) return { user: null }
    const doc = await payload.findByID({ collection: 'bauherren', id: session.id, depth: 0, overrideAccess: true }).catch(() => null)
    if (!doc || doc.sessionVersion !== session.v) return { user: null }
    return { user: (await accountLocked(payload, doc.id)) ? null : { ...doc, collection: 'bauherren', _strategy: 'oidc' } }
  },
}
