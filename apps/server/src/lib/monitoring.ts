import { connect } from 'node:net'
import type { Payload, PayloadRequest } from 'payload'
import { syncManagedConfig } from './gateway'
import { decrypt } from './secrets'

export const SERVICES = ['otlp', 'prometheus', 'grafana'] as const
export type Service = (typeof SERVICES)[number]
/** Services a person can connect today; `prometheus` is refused until the scrape endpoint ships. */
export const OFFERED: readonly Service[] = ['otlp', 'grafana']
export const TITLES: Record<Service, string> = { otlp: 'Traces (OTLP)', prometheus: 'Prometheus', grafana: 'Grafana' }
export const TIMEOUT_MS = 5000

type Cfg = Record<string, unknown>
type Issue = { path: string; message: string }

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?:(\d{1,5})$/
const HEADER = /^[A-Za-z0-9-]{1,64}$/

/** An http(s) URL without credentials, query or fragment, or null. */
export const webUrl = (v: unknown): URL | null => {
  try {
    const u = new URL(String(v))
    return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password && !u.search && !u.hash ? u : null
  } catch {
    return null
  }
}

/** Field errors of a monitoring Connection (`secret` is the plaintext being written, if any); empty = valid. */
export const monitoringErrors = (service: Service | undefined, config: Cfg, secret: string | undefined, hasSecret: boolean): Issue[] => {
  const out: Issue[] = []
  const bad = (path: string, message: string) => out.push({ path, message })
  if (!service || !OFFERED.includes(service)) return [{ path: 'service', message: service === 'prometheus' ? 'Prometheus is not available yet' : 'choose Traces (OTLP) or Grafana' }]
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
  } else if (!webUrl(config.url)) bad('url', 'must be an http(s) URL without credentials, e.g. https://grafana.example.com')
  return out
}

type Tracing = Record<string, unknown>
type Conn = { config?: Cfg | null; secret?: string | null }

/** The gateway's `frontendPolicies.tracing` for the saved OTLP Connection; without one, what `init` renders (`OTEL_ENABLED=1`: the bundled Jaeger) or null (no tracing). The header value goes into the 0600 config.yaml only. */
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

/** Monitoring Connections of the instance, secret included (server only: callers decrypt in memory and never hand it on). */
export const monitoringRows = async (payload: Payload, req?: PayloadRequest, service?: Service): Promise<Row[]> =>
  (await payload.find({ collection: 'connections', where: { kind: { equals: 'monitoring' }, ...(service ? { service: { equals: service } } : {}) }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, showHiddenFields: true, ...(req ? { req } : {}) })).docs as unknown as Row[]

/**
 * Writes the gateway's tracing from the saved OTLP Connection (or the bundled behaviour when there is none) into config.yaml; a no-op when unchanged, the gateway hot-reloads.
 * `boot` leaves a config without a saved Connection alone (a hand-edited tracing block survives a restart).
 */
export const renderTracing = async (payload: Payload, req?: PayloadRequest, boot = false): Promise<void> => {
  const row = (await monitoringRows(payload, req, 'otlp'))[0]
  await syncManagedConfig(row || !boot ? tracingPolicy(row) : undefined)
}

/** UI URL the saved OTLP Connection names for "Open traces". */
export const savedTracesUrl = async (payload: Payload): Promise<string | undefined> => {
  const url = (await monitoringRows(payload, undefined, 'otlp'))[0]?.config?.uiUrl
  return webUrl(url) ? String(url) : undefined
}

/** Saved Grafana URL for "Open dashboards". */
export const savedGrafanaUrl = async (payload: Payload): Promise<string | undefined> => {
  const url = (await monitoringRows(payload, undefined, 'grafana'))[0]?.config?.url
  return webUrl(url) ? String(url) : undefined
}

export type TestResult = { ok: true; message: string } | { ok: false; message: string }

const WHY: Record<string, string> = { ECONNREFUSED: 'connection refused', ETIMEDOUT: 'timed out', ENOTFOUND: 'host not found', EHOSTUNREACH: 'host unreachable', ENETUNREACH: 'network unreachable', ECONNRESET: 'connection reset' }
const why = (e: unknown): string => {
  const code = (e as { code?: string; cause?: { code?: string; message?: string }; name?: string })
  if (code.cause?.message === 'bad port') return 'that port is blocked for web requests'
  return WHY[code.code ?? code.cause?.code ?? ''] ?? (code.name === 'TimeoutError' || code.name === 'AbortError' ? 'timed out' : 'failed')
}

/** TCP connect, `timeoutMs` limit. */
const reach = (host: string, port: number, timeoutMs: number): Promise<string | null> =>
  new Promise((resolve) => {
    const s = connect({ host, port })
    const done = (r: string | null) => (s.destroy(), resolve(r))
    s.setTimeout(timeoutMs, () => done('timed out'))
    s.once('connect', () => done(null))
    s.once('error', (e) => done(why(e)))
  })

/** One GET; a redirect is never followed (it could leave the host). Errors say the origin and a reason, never headers or the body. */
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

/** Plain-word check of one monitoring Connection (`secret` is the decrypted credential, if any). Nothing but a fixed phrase, the host and a reason leaves this function. */
export const testMonitoring = async (service: Service, config: Cfg, secret: string | null, timeoutMs = TIMEOUT_MS): Promise<TestResult> => {
  if (service === 'otlp') {
    const [host, port] = String(config.host).split(':')
    const failure = await reach(host, Number(port), timeoutMs)
    return failure ? { ok: false, message: `Cannot reach ${config.host} (${failure})` } : { ok: true, message: `Reachable: ${config.host} accepts connections. The gateway sends traces there; this check does not send one.` }
  }
  const url = webUrl(config.url)
  if (service !== 'grafana' || !url) return { ok: false, message: 'Not available yet' }
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

/** What the Connections page shows per saved service: the plain config and the state of the last test, never the credential (only whether one is stored). */
export const loadMonitoring = async (payload: Payload): Promise<Partial<Record<Service, MonitoringView>>> =>
  Object.fromEntries(
    (await monitoringRows(payload)).map((r) => [
      r.service,
      {
        id: Number(r.id),
        config: Object.fromEntries(Object.entries(r.config ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
        hasSecret: !!r.secret,
        status: r.capabilities?.lastError ? 'failed' : r.capabilities?.verifiedAt ? 'ok' : 'none',
        detail: String(r.capabilities?.lastError ?? r.capabilities?.verifiedAt ?? ''),
      } satisfies MonitoringView,
    ]),
  )
