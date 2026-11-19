import { randomBytes, randomUUID } from 'node:crypto'
import { chown, mkdir, readdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import pg from 'pg'
import type { Payload, PayloadRequest } from 'payload'
import { parse, stringify } from 'yaml'
import { envInt } from './db-pool'
import { KEY_HEADERS, PRESETS, presetOf } from './providers'
import { decrypt, encrypt } from './secrets'

export const DEFAULT_MODEL_BY_TIER = { cheap: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }

type Ws = { id: number | string; slug: string; gatewayKey?: string | null; budgetUsd30d?: number | null; budgetUnit?: string | null; budgetTokens30d?: number | null }
type Resource = { id: string; value: { key: string; metadata?: { name?: string; kind?: string } } }

export const gatewayPublicUrl = (): string => (process.env.GATEWAY_PUBLIC_URL || `http://127.0.0.1:${process.env.GATEWAY_PORT || 4000}`).replace(/\/+$/, '')

export const gatewayEnabled = (): boolean => {
  if (process.env.GATEWAY_ADMIN_URL) return true
  console.info('gateway: GATEWAY_ADMIN_URL unset, skipping')
  return false
}

export const newKey = (): string => `sk-bauherr-${randomBytes(24).toString('hex')}`
const keyName = (slug: string) => `workspace-${slug}`
const sessionKeyName = (slug: string) => `${keyName(slug)}-session`
const dir = () => process.env.GATEWAY_CONFIG_DIR ?? '/gateway'
export const providerFile = (ws: string, conn: string, ext: 'key' | 'json' = 'key') => join(dir(), 'providers', `ws-${ws}.${conn}.${ext}`)
const KEYS = '/api/config/resources/llm.apiKey'

const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  let last = ''
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250 * 2 ** i))
    try {
      const res = await fetch(process.env.GATEWAY_ADMIN_URL + path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(Number(process.env.GATEWAY_ADMIN_TIMEOUT_MS ?? 10_000)),
      })
      if (res.ok) return (await res.json()) as T
      last = String(res.status)
      if (res.status < 500) break
    } catch {
      last = 'network error'
    }
  }
  throw new Error(`gateway ${method} ${path}: ${last}`)
}

const keyNamed = async (name: string): Promise<Resource | undefined> =>
  (await call<{ resources: Resource[] }>('GET', KEYS)).resources.find((r) => r.value.metadata?.name === name)
const keyOf = (slug: string) => keyNamed(keyName(slug))

const budget = (ws: Ws) => {
  const tokens = ws.budgetUnit === 'tokens'
  const base = tokens ? ws.budgetTokens30d ?? 20_000_000 : ws.budgetUsd30d ?? 50
  return [{ name: 'monthly', limit: { unit: tokens ? 'Tokens' : 'USD', amount: base }, window: { rolling: '30d' }, onBudgetExceeded: 'Block' }]
}

export const writeSecretFile = async (path: string, value: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, { mode: 0o600 })
  if (process.getuid?.() === 0) {
    const { uid, gid } = await stat(dirname(path))
    await chown(path, uid, gid)
  }
}

const loadWs = async (req: PayloadRequest, id: number | string): Promise<Ws> =>
  (await req.payload.findByID({ collection: 'workspaces', id, depth: 0, overrideAccess: true, req })) as unknown as Ws

export const ensureKey = async (req: PayloadRequest, id: number | string): Promise<void> => {
  const ws = await loadWs(req, id)
  if (!ws.gatewayKey) throw new Error(`workspace ${ws.slug} has no gateway key`)
  const value = {
    key: decrypt(ws.gatewayKey),
    metadata: { name: keyName(ws.slug), user: keyName(ws.slug) },
    allowedModels: [`ws-${ws.slug}/*`],
    budgets: budget(ws),
  }
  const existing = await keyOf(ws.slug)
  if (existing) await call('PUT', `${KEYS}/${existing.id}`, { value })
  else await call('PUT', KEYS, { resources: [{ value }] })
  await ensureSessionKey(ws)
}

export const ensureSessionKey = async (ws: Ws, rotate = false): Promise<string> => {
  const existing = await keyNamed(sessionKeyName(ws.slug))
  const value = {
    key: (!rotate && existing?.value.key) || newKey(),
    metadata: { name: sessionKeyName(ws.slug), user: keyName(ws.slug), kind: 'owner-session' },
    allowedModels: ['sub/*', 'claude-*', `ws-${ws.slug}/*`],
    budgets: [{ name: 'monthly', limit: { unit: 'USD', amount: envInt(process.env, 'SESSION_BUDGET_USD', 100) }, window: { rolling: '30d' }, onBudgetExceeded: 'Audit' }],
  }
  if (existing) await call('PUT', `${KEYS}/${existing.id}`, { value })
  else await call('PUT', KEYS, { resources: [{ value }] })
  if (process.env.BAUHERR_SESSION_KEY_FILE) await writeSecretFile(process.env.BAUHERR_SESSION_KEY_FILE, value.key)
  return value.key
}

export const rotateSessionKey = async (req: PayloadRequest, id: number | string): Promise<string> => ensureSessionKey(await loadWs(req, id), true)

export const tierModels = async (payload: Payload, ws: Record<string, any>, req?: PayloadRequest): Promise<Record<string, string>> => {
  const set = (ws.modelByTier ?? {}) as Record<string, string>
  const conns = (await payload.find({ collection: 'connections', where: { workspace: { equals: ws.id }, kind: { equals: 'llm-provider' } }, sort: 'id', select: { provider: true, slug: true }, depth: 0, pagination: false, overrideAccess: true, ...(req ? { req } : {}) })).docs as Record<string, any>[]
  const first = Object.keys(DEFAULT_MODEL_BY_TIER).some((t) => !set[t]) ? conns[0] : undefined
  return Object.fromEntries(
    Object.entries(DEFAULT_MODEL_BY_TIER).map(([t, def]) => {
      if (set[t]) return [t, `ws-${ws.slug}/${set[t]}`]
      if (!first) throw new Error(`Workspace ${ws.slug} has no LLM provider Connection for tier "${t}"`)
      return [t, `ws-${ws.slug}/${first.slug}/${def}`]
    }),
  )
}

const archivedIds = async (req: PayloadRequest): Promise<(number | string)[]> => {
  const has = (await req.payload.db.drizzle.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'workspaces' AND column_name = 'archived_at' AND table_schema = current_schema()`)).rows.length
  if (!has) return []
  return (await req.payload.find({ collection: 'workspaces', where: { archivedAt: { exists: true } }, select: {}, pagination: false, depth: 0, overrideAccess: true, req })).docs.map((w) => w.id)
}

export const rotateKey = async (req: PayloadRequest, id: number | string): Promise<void> => {
  await req.payload.update({ collection: 'workspaces', id, data: { gatewayKey: encrypt(newKey()) }, overrideAccess: true, req })
  await ensureKey(req, id)
}

export const deleteKey = async (slug: string): Promise<void> => {
  for (const name of [keyName(slug), sessionKeyName(slug)]) {
    const existing = await keyNamed(name)
    if (existing) await call('DELETE', `${KEYS}/${existing.id}`)
  }
}

const cache = new Map<string, { at: number; v: { spentUsd: number; limitUsd: number | null } }>()

export const budgetStatus = async (slug: string): Promise<{ spentUsd: number; limitUsd: number | null }> => {
  const hit = cache.get(slug)
  if (hit && Date.now() - hit.at < 60_000) return hit.v
  const db = new pg.Client({ connectionString: process.env.GATEWAY_DATABASE_URL })
  await db.connect()
  try {
    const r = await db.query(
      `SELECT COALESCE(SUM(cost), 0) AS spent FROM request_logs WHERE agentgateway_user = $1 AND completed_at > now() - interval '30 days'`,
      [keyName(slug)],
    )
    const limit = (await keyOf(slug)) as unknown as { value: { budgets?: { limit: { amount: number } }[] } } | undefined
    const v = { spentUsd: Number(r.rows[0].spent), limitUsd: limit?.value.budgets?.[0]?.limit.amount ?? null }
    cache.set(slug, { at: Date.now(), v })
    return v
  } finally {
    await db.end()
  }
}

export const writeProvider = async (ws: string, conn: string, secret: string, ext: 'key' | 'json' = 'key'): Promise<void> => {
  await mkdir(join(dir(), 'providers'), { recursive: true })
  const tmp = `${providerFile(ws, conn, ext)}.tmp`
  await writeFile(tmp, secret, { mode: 0o600 })
  await rename(tmp, providerFile(ws, conn, ext))
}

export const removeProvider = (ws: string, conn: string, ...exts: ('key' | 'json')[]) =>
  Promise.all((exts.length ? exts : (['key', 'json'] as const)).map((e) => rm(providerFile(ws, conn, e), { force: true })))

export const removeWorkspaceProviders = async (ws: string): Promise<void> => {
  const files = await readdir(join(dir(), 'providers')).catch(() => [] as string[])
  await Promise.all(files.filter((f) => f.startsWith(`ws-${ws}.`) && /^[a-z0-9-]+\.(key|json)$/.test(f.slice(`ws-${ws}.`.length))).map((f) => rm(join(dir(), 'providers', f), { force: true })))
}

export const KEY_LOCATION = 'coalesce(request.headers["x-agw-key"], request.headers["x-api-key"], request.headers["x-goog-api-key"], request.headers["authorization"].stripPrefix("Bearer "))'
const OLD_KEY_LOCATION = 'coalesce(request.headers["x-agw-key"], request.headers["authorization"].stripPrefix("Bearer "))'

export const SESSION_LOG_FIELDS = {
  session: 'request.headers["x-bauherr-session"]',
  role: 'request.headers["x-bauherr-role"]',
  client: 'coalesce(request.headers["x-bauherr-client"], request.headers["user-agent"])',
} as const

export const ensureManaged = (cfg: Record<string, any>, catalogFiles: string[], tracing?: Record<string, unknown> | null): boolean => {
  const before = JSON.stringify(cfg)
  if (tracing !== undefined) {
    cfg.frontendPolicies ??= {}
    if (tracing) cfg.frontendPolicies.tracing = tracing
    else delete cfg.frontendPolicies.tracing
  }
  const log = ((((cfg.frontendPolicies ??= {}).accessLog ??= {}).database ??= {}).add ??= {}) as Record<string, string>
  for (const [k, v] of Object.entries(SESSION_LOG_FIELDS)) log[k] ??= v
  const models = (cfg.llm?.models ?? []) as { name: string; transformation?: unknown; requestHeaders?: { remove?: string[] } }[]
  const location = cfg.llm?.policies?.apiKey?.location
  if (location?.expression === OLD_KEY_LOCATION) location.expression = KEY_LOCATION
  for (const m of models.filter((x) => x.name === 'sub/*')) m.requestHeaders = { ...m.requestHeaders, remove: [...new Set([...(m.requestHeaders?.remove ?? []), ...KEY_HEADERS])] }
  const sub = models.find((m) => m.name === 'sub/*')
  if (sub && !models.some((m) => m.name === 'claude-*')) {
    const { transformation: _t, ...rest } = structuredClone(sub)
    models.splice(models.indexOf(sub) + 1, 0, { ...rest, name: 'claude-*' })
  }
  if (catalogFiles.length) cfg.config = { ...cfg.config, modelCatalog: catalogFiles.map((f) => ({ file: join(dir(), 'catalogs', f) })) }
  return JSON.stringify(cfg) !== before
}

const catalogFiles = async (): Promise<string[]> => (await readdir(join(dir(), 'catalogs')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort()

let configQueue: Promise<unknown> = Promise.resolve()

export const withConfig = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = configQueue.then(fn, fn)
  configQueue = run.catch(() => undefined)
  return run
}

const writeConfig = async (path: string, cfg: unknown): Promise<void> => {
  const tmp = `${path}.${randomUUID()}.tmp`
  await writeSecretFile(tmp, stringify(cfg))
  await rename(tmp, path)
}

export const syncManagedConfig = (tracing?: Record<string, unknown> | null): Promise<boolean> =>
  withConfig(async () => {
    const path = join(dir(), 'config.yaml')
    const cfg = parse(await readFile(path, 'utf8').catch(() => ''))
    if (!cfg || typeof cfg !== 'object' || !ensureManaged(cfg, await catalogFiles(), tracing)) return false
    await writeConfig(path, cfg)
    return true
  })

export const renderModels = async (req: PayloadRequest): Promise<void> => {
  const conns = await req.payload.find({
    collection: 'connections',
    where: { kind: { equals: 'llm-provider' } },
    select: { slug: true, config: true, secret: true, workspace: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const gone = await archivedIds(req)
  const slugs = new Map(
    (await req.payload.find({ collection: 'workspaces', select: { slug: true }, depth: 0, pagination: false, overrideAccess: true, req })).docs.filter((w) => !gone.includes(w.id)).map((w) => [w.id, w.slug as string] as const),
  )
  const models = conns.docs
    .flatMap((c) => {
      try {
        const slug = slugs.get(c.workspace as number)
        const conn = c.slug as string | null | undefined
        const cfg = c.config as Record<string, string> | null
        const def = PRESETS[presetOf(cfg)]
        const secret = def.auth === 'inline' && c.secret ? decrypt(c.secret as string) : undefined
        if (!slug || !conn || (def.auth === 'inline' && !secret)) return []
        return [{ key: `${slug}/${conn}`, entry: def.render(`${slug}/${conn}`, cfg ?? {}, providerFile(slug, conn, def.secret.ext), secret) }]
      } catch {
        req.payload.logger.error(`renderModels: skipped Connection ${c.id}, stored provider config is invalid`)
        return []
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => m.entry)
  await withConfig(async () => {
    const path = join(dir(), 'config.yaml')
    const cfg = parse(await readFile(path, 'utf8'))
    const kept = ((cfg.llm?.models ?? []) as { name: string }[]).filter((m) => !m.name.startsWith('ws-'))
    cfg.llm = { ...cfg.llm, models: [...kept, ...models] }
    ensureManaged(cfg, await catalogFiles())
    await writeConfig(path, cfg)
  })
}

export const completeCheap = async (w: { slug: string; gatewayKey: string; modelByTier?: Partial<typeof DEFAULT_MODEL_BY_TIER> | null }, system: string, user: string): Promise<string> => {
  const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${decrypt(w.gatewayKey)}` },
    body: JSON.stringify({ model: `ws-${w.slug}/${{ ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }.cheap}`, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`gateway completion failed: HTTP ${res.status}`)
  return ((await res.json()) as { content: { type: string; text?: string }[] }).content.find((c) => c.type === 'text')?.text ?? ''
}

export const verifyProvider = async (slug: string, key: string, model: string): Promise<{ verifiedAt: string } | { lastError: string }> => {
  let last = 'network error'
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 500))
    try {
      const res = await fetch(`${process.env.GATEWAY_URL}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: `ws-${slug}/${model}`, max_tokens: 1, messages: [{ role: 'user', content: 'ok' }] }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) return { verifiedAt: new Date().toISOString() }
      last = `HTTP ${res.status}`
    } catch {}
  }
  return { lastError: last }
}
