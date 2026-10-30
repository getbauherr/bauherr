import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuthStrategy } from 'payload'
import { secret } from './secrets'

export const SESSION_COOKIE = 'bauherr-session'
export const SESSION_TTL_S = 7 * 86400

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

export const oidcStrategy: AuthStrategy = {
  name: 'oidc',
  authenticate: async ({ payload, headers }) => {
    const token = headers.get('cookie')?.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1)
    const session = token ? verifySession(token) : null
    if (!session) return { user: null }
    const doc = await payload.findByID({ collection: 'bauherren', id: session.id, depth: 0, overrideAccess: true }).catch(() => null)
    const locked = !!doc?.lockUntil && new Date(doc.lockUntil as string).getTime() > Date.now()
    return { user: doc && !locked && doc.sessionVersion === session.v ? { ...doc, collection: 'bauherren', _strategy: 'oidc' } : null }
  },
}
