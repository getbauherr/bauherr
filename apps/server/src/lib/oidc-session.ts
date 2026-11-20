import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AuthStrategy, Payload } from 'payload'
import { z } from 'zod'
import { secret } from './secrets'

export const SESSION_COOKIE = 'bauherr-session'
export const SESSION_TTL_S = 14 * 86400

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const mac = (body: string, key: string) => createHmac('sha256', key).update(body).digest()

export const signSession = (
  id: number | string,
  v: number,
  key = secret('PAYLOAD_SECRET'),
  now = Date.now(),
): string => {
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const exp = Math.floor(now / 1000) + SESSION_TTL_S
  const body = `${header}.${b64(JSON.stringify({ id, v, typ: 'bauherr-session', aud: 'bauherr', exp }))}`
  return `${body}.${b64(mac(body, key))}`
}

const sessionClaims = z.object({
  id: z.union([z.number(), z.string()]),
  v: z.number(),
  exp: z.number(),
  typ: z.literal('bauherr-session'),
  aud: z.literal('bauherr'),
})

const unexpiredClaims = (payload: string, now: number): { id: number | string; v: number } | null => {
  try {
    const claims = sessionClaims.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString()))
    return claims.success && claims.data.exp * 1000 > now ? { id: claims.data.id, v: claims.data.v } : null
  } catch {
    return null
  }
}

export const verifySession = (
  token: string,
  key = secret('PAYLOAD_SECRET'),
  now = Date.now(),
): { id: number | string; v: number } | null => {
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) return null
  const want = mac(`${h}.${p}`, key)
  const got = Buffer.from(s, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  return unexpiredClaims(p, now)
}

export const isLocked = (lockUntil?: string | null): boolean =>
  !!lockUntil && new Date(lockUntil).getTime() > Date.now()

export const ACCOUNT_LOCKED = 'This account is locked.'

export const lockedRequests = new WeakSet<Headers>()

export const carriesPayloadCredential = (headers?: Headers | null): boolean =>
  /^(bauherren API-Key|JWT|Bearer) /.test(headers?.get?.('authorization') ?? '') ||
  /(^|;\s*)payload-token=/.test(headers?.get?.('cookie') ?? '')

export const accountLocked = async (payload: Payload, id: number | string): Promise<boolean> => {
  const lock = await payload
    .findByID({
      collection: 'bauherren',
      id,
      depth: 0,
      overrideAccess: true,
      showHiddenFields: true,
      select: { lockUntil: true },
    })
    .catch(() => null)
  return !lock || isLocked(lock.lockUntil as string | null | undefined)
}

export const oidcStrategy: AuthStrategy = {
  name: 'oidc',
  authenticate: async ({ payload, headers }) => {
    const token = headers
      .get('cookie')
      ?.split(/;\s*/)
      .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1)
    const session = token ? verifySession(token) : null
    if (!session) return { user: null }
    const doc = await payload
      .findByID({ collection: 'bauherren', id: session.id, depth: 0, overrideAccess: true })
      .catch(() => null)
    if (!doc || doc.sessionVersion !== session.v) return { user: null }
    return {
      user: (await accountLocked(payload, doc.id)) ? null : { ...doc, collection: 'bauherren', _strategy: 'oidc' },
    }
  },
}
