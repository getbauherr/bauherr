import { personOf } from '../../../lib/person'
import { getBauherr, payloadClient, WS_COOKIE } from './session'
import { cookies } from 'next/headers'

/** Request headers that cross the proxy; everything else (Cookie, Authorization, session and forwarding headers) stays behind. */
const FORWARD = ['accept', 'accept-language', 'content-type', 'range', 'if-none-match', 'if-modified-since']
const DROP_RESPONSE = ['set-cookie', 'content-encoding', 'content-length', 'transfer-encoding', 'connection']
const HEADERS_TIMEOUT_MS = 10_000

const fallback = (name: string, hint: string): Response =>
  new Response(`<!doctype html><meta charset="utf-8"><title>${name} not reachable</title><h1>${name} is not reachable from the server</h1><p>${hint}</p>`, { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } })

type Target = { name: string; url: string | undefined; hint: string; writes: boolean; /** Path the upstream serves its UI under; `/-/traces` for Jaeger. */ prefix?: string }

/**
 * Admin-only reverse proxy to a native UI. Anyone but an Admin gets a plain 404 (the route's existence stays hidden).
 * Only GET and HEAD pass unless `target.writes`; a write that passes is recorded in `human_touches` first, and refused when it cannot be recorded.
 */
export async function proxyAdmin(req: Request, target: Target, path: string[] = []): Promise<Response> {
  const user = await getBauherr()
  if (user?.role !== 'admin') return new Response('Not found', { status: 404 })
  const write = req.method !== 'GET' && req.method !== 'HEAD'
  if (write && !target.writes) return new Response('Read-only: set GATEWAY_ADMIN_PROXY_WRITE=1 to allow writes.', { status: 405, headers: { allow: 'GET, HEAD' } })
  if (!target.url) return fallback(target.name, target.hint)

  const url = new URL(`${target.prefix ?? ''}/${path.map(encodeURIComponent).join('/')}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`, target.url)
  if (write) {
    const slug = (await cookies()).get(WS_COOKIE)?.value
    const payload = await payloadClient()
    const found = (await payload.find({ collection: 'workspaces', where: slug ? { slug: { equals: slug } } : {}, sort: 'id', limit: 1, depth: 0, overrideAccess: true })).docs[0]
    await payload.create({ collection: 'human_touches', data: { kind: `${target.name.toLowerCase()}:${req.method}`, path: url.pathname, actor: personOf(user), at: new Date().toISOString(), workspace: found?.id } as never, overrideAccess: true })
  }

  const headers = new Headers()
  for (const h of FORWARD) if (req.headers.has(h)) headers.set(h, req.headers.get(h)!)
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), HEADERS_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: req.method, headers, body: write ? req.body : undefined, redirect: 'manual', signal: abort.signal, ...(write && { duplex: 'half' }) } as RequestInit)
    const out = new Headers(res.headers)
    for (const h of DROP_RESPONSE) out.delete(h)
    return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers: out })
  } catch {
    return fallback(target.name, target.hint)
  } finally {
    clearTimeout(timer)
  }
}

let probe: { at: number; up: boolean } | undefined

/** Whether Jaeger answers (the `observability` profile is on); a HEAD probe cached for 60 s. */
export async function tracesUp(base = process.env.JAEGER_URL ?? JAEGER_DEFAULT): Promise<boolean> {
  if (probe && Date.now() - probe.at < 60_000) return probe.up
  const up = await fetch(new URL(`${TRACES_PREFIX}/`, base), { method: 'HEAD', signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false)
  probe = { at: Date.now(), up }
  return up
}

export const JAEGER_DEFAULT = 'http://jaeger:16686'
export const TRACES_PREFIX = '/-/traces'
