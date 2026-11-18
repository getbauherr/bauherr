import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { connect } from 'node:net'
import type { Payload, PayloadRequest } from 'payload'
import { syncManagedConfig } from './gateway'
import { decrypt } from './secrets'

export const SERVICES = ['otlp', 'prometheus', 'grafana'] as const
export type Service = (typeof SERVICES)[number]
export const OFFERED: readonly Service[] = ['otlp', 'prometheus', 'grafana']
export const TITLES: Record<Service, string> = { otlp: 'Traces (OTLP)', prometheus: 'Prometheus', grafana: 'Grafana' }
export const TIMEOUT_MS = 5000

type Cfg = Record<string, unknown>
type Issue = { path: string; message: string }

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:(\d{1,5})$/
const HEADER = /^[A-Za-z0-9-]{1,64}$/

export const webUrl = (v: unknown): URL | null => {
  try {
    const u = new URL(String(v))
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && !u.search && !u.hash ? u : null
  } catch {
    return null
  }
}

export const monitoringErrors = (service: Service | undefined, config: Cfg, secret: string | undefined, hasSecret: boolean): Issue[] => {
  const out: Issue[] = []
  const bad = (path: string, message: string) => out.push({ path, message })
  if (!service || !OFFERED.includes(service)) return [{ path: 'service', message: 'choose Traces (OTLP), Prometheus or Grafana' }]
  if (secret && /[\r\n]/.test(secret)) bad('secret', 'must be one line')
  if (service === 'otlp') {
    const m = HOST.exec(String(config.host ?? ''))
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) bad('host', 'must be host:port, e.g. collector.example.com:4317')
    if (!['grpc', 'http'].includes(String(config.protocol))) bad('protocol', 'choose grpc or http')
    const name = config.headerName
    if (name && !HEADER.test(String(name))) bad('headerName', 'letters, digits and - only')
    if (name && !secret && !hasSecret) bad('secret', 'required with a header name')
    if (!name && secret) bad('headerName', 'required with a header value')
    if (config.uiUrl && !webUrl(config.uiUrl)) bad('uiUrl', 'must be an http(s) URL without credentials')
  } else {
    if (!webUrl(config.url)) bad('url', `must be an http(s) URL without credentials, e.g. https://${service}.example.com`)
    if (service === 'prometheus' && !/^[a-f0-9]{64}$/.test(String(config.tokenHash ?? ''))) bad('tokenHash', 'the scrape token is minted on saving')
  }
  return out
}

type Tracing = Record<string, unknown>
type Conn = { config?: Cfg | null; secret?: string | null }

export const tracingPolicy = (conn: Conn | undefined): Tracing | null => {
  if (!conn) return process.env.OTEL_ENABLED === '1' ? { host: 'jaeger:4317', randomSampling: true } : null
  const c = conn.config ?? {}
  return {
    host: c.host,
    protocol: c.protocol,
    randomSampling: true,
    ...(c.headerName && conn.secret ? { policies: { requestHeaderModifier: { set: { [String(c.headerName)]: decrypt(conn.secret) } } } } : {}),
  }
}

type Row = { id: number | string; service: Service; config: Cfg; secret?: string | null; capabilities?: Cfg | null }

export const monitoringRows = async (payload: Payload, req?: PayloadRequest, service?: Service): Promise<Row[]> =>
  (await payload.find({ collection: 'connections', where: { kind: { equals: 'monitoring' }, ...(service ? { service: { equals: service } } : {}) }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, showHiddenFields: true, ...(req ? { req } : {}) })).docs as unknown as Row[]

export const renderTracing = async (payload: Payload, req?: PayloadRequest, boot = false): Promise<void> => {
  const row = (await monitoringRows(payload, req, 'otlp'))[0]
  await syncManagedConfig(row || !boot ? tracingPolicy(row) : undefined)
}

export const savedTracesUrl = async (payload: Payload): Promise<string | undefined> => {
  const url = (await monitoringRows(payload, undefined, 'otlp'))[0]?.config?.uiUrl
  return webUrl(url) ? String(url) : undefined
}

export const savedGrafanaUrl = async (payload: Payload): Promise<string | undefined> => {
  const url = (await monitoringRows(payload, undefined, 'grafana'))[0]?.config?.url
  return webUrl(url) ? String(url) : undefined
}

export const SCRAPE_JOB = 'bauherr'
const sha256 = (v: string): Buffer => createHash('sha256').update(v).digest()

export const mintScrapeToken = (): { token: string; hash: string } => {
  const token = `bhm_${randomBytes(32).toString('base64url')}`
  return { token, hash: sha256(token).toString('hex') }
}

export const scrapeOrigin = (h: { forwardedHost?: string | null; forwardedProto?: string | null; host?: string | null }): URL => {
  const first = (v?: string | null) => v?.split(',')[0]?.trim() ?? ''
  const proto = first(h.forwardedProto).toLowerCase()
  for (const host of [first(h.forwardedHost), first(h.host)]) {
    try {
      const u = new URL(`${proto === 'http' || proto === 'https' ? proto : /^(localhost|127\.)/.test(host) ? 'http' : 'https'}://${host}`)
      if (host && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash) return u
    } catch {}
  }
  return new URL('http://localhost')
}

export const scrapeSnippet = (origin: URL, token: string): string =>
  `scrape_configs:\n  - job_name: ${SCRAPE_JOB}\n    scheme: ${origin.protocol.slice(0, -1)}\n    metrics_path: /-/metrics\n    authorization:\n      type: Bearer\n      credentials: ${token}\n    static_configs:\n      - targets: ['${origin.host}']`

export const SCRAPE_TOKEN = /^bhm_[A-Za-z0-9_-]{43}$/

export const scrapeTokenValid = async (payload: Payload, presented: string): Promise<boolean> => {
  const stored = String((await monitoringRows(payload, undefined, 'prometheus'))[0]?.config?.tokenHash ?? '')
  const want = Buffer.from(/^[a-f0-9]{64}$/.test(stored) ? stored : '0'.repeat(64), 'hex')
  return timingSafeEqual(sha256(presented), want) && /^[a-f0-9]{64}$/.test(stored)
}

export type TestResult = { ok: true; message: string } | { ok: false; message: string }

const WHY: Record<string, string> = { ECONNREFUSED: 'connection refused', ETIMEDOUT: 'timed out', ENOTFOUND: 'host not found', EHOSTUNREACH: 'host unreachable', ENETUNREACH: 'network unreachable', ECONNRESET: 'connection reset' }
const why = (e: unknown): string => {
  const code = (e as { code?: string; cause?: { code?: string; message?: string }; name?: string })
  if (code.cause?.message === 'bad port') return 'that port is blocked for web requests'
  return WHY[code.code ?? code.cause?.code ?? ''] ?? (code.name === 'TimeoutError' || code.name === 'AbortError' ? 'timed out' : 'failed')
}

const reach = (host: string, port: number, timeoutMs: number): Promise<string | null> =>
  new Promise((resolve) => {
    const s = connect({ host, port })
    const done = (r: string | null) => (s.destroy(), resolve(r))
    s.setTimeout(timeoutMs, () => done('timed out'))
    s.once('connect', () => done(null))
    s.once('error', (e) => done(why(e)))
  })

const get = async (url: URL, path: string, token: string | undefined, timeoutMs: number): Promise<{ status: number; body: unknown } | string> => {
  try {
    const res = await fetch(new URL(path, `${url.origin}${url.pathname.replace(/\/+$/, '')}/`), {
      redirect: 'manual',
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch (e) {
    return `Cannot reach ${url.origin} (${why(e)})`
  }
}

const testPrometheus = async (url: URL, secret: string | null, timeoutMs: number): Promise<TestResult> => {
  const res = await get(url, `api/v1/query?query=${encodeURIComponent(`up{job="${SCRAPE_JOB}"}`)}`, secret ?? undefined, timeoutMs)
  if (typeof res === 'string') return { ok: false, message: res }
  if (res.status >= 300 && res.status < 400) return { ok: false, message: `${url.origin} redirected instead of answering: use the address Prometheus itself serves (HTTP ${res.status})` }
  if (res.status === 401 || res.status === 403) return { ok: false, message: `${url.origin} did not accept the token (HTTP ${res.status})` }
  const body = res.body as { status?: unknown; data?: { result?: { value?: unknown[] }[] } } | null
  if (res.status !== 200 || body?.status !== 'success' || !Array.isArray(body.data?.result)) return { ok: false, message: `${url.origin} did not answer like Prometheus (HTTP ${res.status})` }
  const up = body.data.result[0]?.value?.[1]
  if (up === undefined) return { ok: false, message: `Prometheus answered, but it has not scraped Bauherr yet (no up{job="${SCRAPE_JOB}"}). Add the scrape snippet to its config.` }
  return up === '1' ? { ok: true, message: "Prometheus answered and Bauherr's metrics target is up" } : { ok: false, message: "Prometheus answered, but Bauherr's metrics target is down (the scrape fails: check the address and the token)" }
}

export const testMonitoring = async (service: Service, config: Cfg, secret: string | null, timeoutMs = TIMEOUT_MS): Promise<TestResult> => {
  if (service === 'otlp') {
    const [host, port] = String(config.host).split(':')
    const failure = await reach(host, Number(port), timeoutMs)
    return failure ? { ok: false, message: `Cannot reach ${config.host} (${failure})` } : { ok: true, message: `Reachable: ${config.host} accepts connections. The gateway sends traces there; this check does not send one.` }
  }
  const url = webUrl(config.url)
  if (!url) return { ok: false, message: 'Not a valid address' }
  if (service === 'prometheus') return testPrometheus(url, secret, timeoutMs)
  const health = await get(url, 'api/health', undefined, timeoutMs)
  if (typeof health === 'string') return { ok: false, message: health }
  if (health.status >= 300 && health.status < 400) return { ok: false, message: `${url.origin} redirected instead of answering: use the address Grafana itself serves (HTTP ${health.status})` }
  const body = health.body as { version?: unknown; database?: unknown } | null
  const version = typeof body?.version === 'string' ? body.version : 'hidden'
  if (health.status !== 200 || (body?.version === undefined && body?.database === undefined)) return { ok: false, message: `${url.origin} did not answer like Grafana (HTTP ${health.status})` }
  if (!secret) return { ok: true, message: `Grafana answered (version ${version})` }
  const user = await get(url, 'api/user', secret, timeoutMs)
  if (typeof user === 'string') return { ok: false, message: user }
  if (user.status === 401 || user.status === 403) return { ok: false, message: `Grafana answered (version ${version}) but did not accept the token` }
  return user.status === 200 ? { ok: true, message: `Grafana answered (version ${version}). Token accepted` } : { ok: false, message: `Grafana answered (version ${version}) but the token check failed (HTTP ${user.status})` }
}

export type MonitoringView = { id: number; config: Record<string, string>; hasSecret: boolean; status: 'ok' | 'failed' | 'none'; detail: string }

export const loadMonitoring = async (payload: Payload): Promise<Partial<Record<Service, MonitoringView>>> =>
  Object.fromEntries(
    (await monitoringRows(payload)).map((r) => [
      r.service,
      {
        id: Number(r.id),
        config: Object.fromEntries(Object.entries(r.config ?? {}).filter(([k, v]) => typeof v === 'string' && k !== 'tokenHash')) as Record<string, string>,
        hasSecret: !!r.secret,
        status: r.capabilities?.lastError ? 'failed' : r.capabilities?.verifiedAt ? 'ok' : 'none',
        detail: String(r.capabilities?.lastError ?? r.capabilities?.verifiedAt ?? ''),
      } satisfies MonitoringView,
    ]),
  )
