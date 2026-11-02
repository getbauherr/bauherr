import { createHash, randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

type Doc = Record<string, any>

const bearer = (req: Request): string | null => /^Bearer (bemb_\S+)$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? null
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** Mints an embed token for a Product. Only the hash is stored; the plaintext is returned once. */
export const createEmbedToken = async (payload: Payload, input: { product: number | string; name: string; allowedOrigins: string[]; maxSessionsPerHour?: number }): Promise<string> => {
  const product = (await payload.findByID({ collection: 'products', id: input.product, depth: 0, overrideAccess: true })) as Doc
  const token = `bemb_${randomBytes(32).toString('base64url')}`
  await payload.create({
    collection: 'embed_tokens',
    data: { name: input.name, product: product.id, workspace: typeof product.workspace === 'object' ? product.workspace.id : product.workspace, tokenHash: hashToken(token), allowedOrigins: input.allowedOrigins.map((o) => new URL(o).origin), maxSessionsPerHour: input.maxSessionsPerHour },
    overrideAccess: true,
  })
  return token
}

/** The embed token of this request, or: null (no embed token sent), 403 Response (unknown, revoked, or Origin not on the allowlist). */
export const embedAuth = async (payload: Payload, req: Request): Promise<Doc | Response | null> => {
  const raw = bearer(req)
  if (!raw) return null
  const t = (await payload.find({ collection: 'embed_tokens', where: { tokenHash: { equals: hashToken(raw) } }, limit: 1, depth: 0, overrideAccess: true })).docs[0] as Doc | undefined
  const origin = req.headers.get('origin')
  return t && !t.revokedAt && origin && ((t.allowedOrigins as string[] | null) ?? []).includes(origin) ? t : Response.json({ error: 'forbidden' }, { status: 403 })
}

/** Adds CORS headers for embed-token requests the server accepted (any non-403: the Origin was checked against the allowlist). */
export const withCors =
  <A extends unknown[]>(handler: (req: Request, ...args: A) => Promise<Response>) =>
  async (req: Request, ...args: A): Promise<Response> => {
    const res = await handler(req, ...args)
    const origin = req.headers.get('origin')
    if (origin && bearer(req) && res.status !== 403) {
      res.headers.set('access-control-allow-origin', origin)
      res.headers.append('vary', 'Origin')
    }
    return res
  }

/** Preflight cannot carry the token, so it only echoes the Origin; the actual request is what is checked. */
export const preflight = (req: Request): Response =>
  new Response(null, {
    status: 204,
    headers: { ...(req.headers.get('origin') && { 'access-control-allow-origin': req.headers.get('origin')! }), 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600', vary: 'Origin' },
  })
