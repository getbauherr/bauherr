import { getPayload } from 'payload'
import config from '../../../payload.config'
import { SCRAPE_TOKEN, scrapeTokenValid } from '../../../lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TIMEOUT_MS = 5000
const refuse = () => new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Bearer realm="bauherr-metrics"', 'cache-control': 'no-store' } })

export const GET = async (req: Request): Promise<Response> => {
  const presented = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!presented || !SCRAPE_TOKEN.test(presented) || !(await scrapeTokenValid(await getPayload({ config }), presented))) return refuse()
  try {
    const res = await fetch(process.env.GATEWAY_METRICS_URL ?? 'http://gateway:15020/metrics', { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return new Response('Gateway metrics unavailable', { status: 502 })
    return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') ?? 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' } })
  } catch {
    return new Response('Gateway metrics unavailable', { status: 502 })
  }
}
