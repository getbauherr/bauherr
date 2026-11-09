import { randomBytes } from 'node:crypto'
import { chown, mkdir, readdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import pg from 'pg'
import type { Payload, PayloadRequest } from 'payload'
import { parse, stringify } from 'yaml'
import { PRESETS, presetOf } from './providers'
import { decrypt, encrypt } from './secrets'

export const DEFAULT_MODEL_BY_TIER = { cheap: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }

type Ws = { id: number | string; slug: string; gatewayKey?: string | null; routerKey?: string | null; budgetUsd30d?: number | null; budgetUnit?: string | null; budgetTokens30d?: number | null }
type Resource = { id: string; value: { key: string; metadata?: { name?: string; kind?: string } } }

/** Hooks no-op without a gateway (tests, seed outside compose). */
export const gatewayEnabled = (): boolean => {
  if (process.env.GATEWAY_ADMIN_URL) return true
  console.info('gateway: GATEWAY_ADMIN_URL unset, skipping')
  return false
}

export const newKey = (): string => `sk-bauherr-${randomBytes(24).toString('hex')}`
const keyName = (slug: string) => `workspace-${slug}`
const sessionKeyName = (slug: string) => `${keyName(slug)}-session`
const routerKeyName = (slug: string) => `${keyName(slug)}-router`
const dir = () => process.env.GATEWAY_CONFIG_DIR ?? '/gateway'
export const providerFile = (ws: string, conn: string, ext: 'key' | 'json' = 'key') => join(dir(), 'providers', `ws-${ws}.${conn}.${ext}`)
const KEYS = '/api/config/resources/llm.apiKey'

/** Admin API call; retries transient failures. Errors carry method, path and status only. */
const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
  let last = ''
  for (let i = 0; i < 4; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250 * 2 ** i))
    try {
      const res = await fetch(process.env.GATEWAY_ADMIN_URL + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
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

/** Workspace key: Block. Owner-session key: Audit — subscription traffic costs the Workspace nothing, the gateway only prices it. */
const budget = (ws: Ws, onBudgetExceeded: 'Block' | 'Audit' = 'Block') => [
  { name: 'monthly', limit: ws.budgetUnit === 'tokens' ? { unit: 'Tokens', amount: ws.budgetTokens30d ?? 20_000_000 } : { unit: 'USD', amount: ws.budgetUsd30d ?? 50 }, window: { rolling: '30d' }, onBudgetExceeded },
]

/** Writes a secret file (0600, owned by the directory's owner so a root container leaves it readable on the host). Never logs the value. */
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

/** Creates or updates the Workspace's consumer key (budget, allowed models) from its stored key. */
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
  await syncRouterKey(req, id)
}

/**
 * Second consumer key per Workspace for the owner's own Claude Code session: `sub/*` (own login) and `ws-<slug>/*` (Workspace API key), see docs/legal.md.
 * The value lives in the gateway only; an existing key is reused. With BAUHERR_SESSION_KEY_FILE set it is written there (0600).
 */
export const ensureSessionKey = async (ws: Ws): Promise<void> => {
  const existing = await keyNamed(sessionKeyName(ws.slug))
  const value = {
    key: existing?.value.key ?? newKey(),
    metadata: { name: sessionKeyName(ws.slug), user: keyName(ws.slug), kind: 'owner-session' },
    allowedModels: ['sub/*', `ws-${ws.slug}/*`],
    budgets: budget(ws, 'Audit'),
  }
  if (existing) await call('PUT', `${KEYS}/${existing.id}`, { value })
  else await call('PUT', KEYS, { resources: [{ value }] })
  if (process.env.BAUHERR_SESSION_KEY_FILE) await writeSecretFile(process.env.BAUHERR_SESSION_KEY_FILE, value.key)
}

/** Gateway model IDs per tier; a tier the Workspace never set gets the default model of its (first) non-router LLM Connection, or fails the Run when it has none. `auto` is added only while the Workspace has a `router` Connection. */
export const tierModels = async (payload: Payload, ws: Record<string, any>, req?: PayloadRequest): Promise<Record<string, string>> => {
  const set = (ws.modelByTier ?? {}) as Record<string, string>
  // Filtered here, not in SQL: older migrations call this through renderModels before the `router` enum value exists, and a query comparing against it aborts their transaction.
  const conns = (await payload.find({ collection: 'connections', where: { workspace: { equals: ws.id }, kind: { equals: 'llm-provider' } }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, ...(req ? { req } : {}) })).docs as Record<string, any>[]
  const first = Object.keys(DEFAULT_MODEL_BY_TIER).some((t) => !set[t]) ? conns.find((c) => c.provider !== 'router') : undefined
  const tiers = Object.fromEntries(
    Object.entries(DEFAULT_MODEL_BY_TIER).map(([t, def]) => {
      if (set[t]) return [t, `ws-${ws.slug}/${set[t]}`]
      if (!first) throw new Error(`Workspace ${ws.slug} has no LLM provider Connection for tier "${t}"`)
      return [t, `ws-${ws.slug}/${first.slug}/${def}`]
    }),
  )
  const router = conns.find((c) => c.provider === 'router')
  return router ? { ...tiers, auto: `ws-${ws.slug}/${router.slug}/auto` } : tiers
}

/**
 * Router key: a third consumer key per Workspace, used only by the vLLM Semantic Router for its inner calls (docs/router.md).
 * Stored encrypted on the Workspace like the gateway key, created once, never shown or logged. `allowedModels` are the tier models, never `.../auto`, so the router cannot loop into itself.
 */
export const ensureRouterKey = async (req: PayloadRequest, id: number | string): Promise<void> => {
  let ws = await loadWs(req, id)
  if (!ws.routerKey) ws = (await req.payload.update({ collection: 'workspaces', id, data: { routerKey: encrypt(newKey()) }, overrideAccess: true, req })) as unknown as Ws
  const { auto: _auto, ...tiers } = await tierModels(req.payload, ws, req)
  const value = {
    key: decrypt(ws.routerKey!),
    metadata: { name: routerKeyName(ws.slug), user: keyName(ws.slug), kind: 'router' },
    allowedModels: [...new Set(Object.values(tiers))],
    budgets: budget(ws),
  }
  const existing = await keyNamed(routerKeyName(ws.slug))
  if (existing) await call('PUT', `${KEYS}/${existing.id}`, { value })
  else await call('PUT', KEYS, { resources: [{ value }] })
}

/** Re-applies the router key (tier models, budget) while the Workspace has one. */
export const syncRouterKey = async (req: PayloadRequest, id: number | string): Promise<void> => {
  if ((await loadWs(req, id)).routerKey) await ensureRouterKey(req, id)
}

/** Revokes the router key and forgets it; the next `router` Connection mints a new one. */
export const revokeRouterKey = async (req: PayloadRequest, id: number | string, slug: string): Promise<void> => {
  const existing = await keyNamed(routerKeyName(slug))
  if (existing) await call('DELETE', `${KEYS}/${existing.id}`)
  await req.payload.update({ collection: 'workspaces', id, data: { routerKey: null }, overrideAccess: true, req })
}

/** Replaces the Workspace key; the old key stops working. */
export const rotateKey = async (req: PayloadRequest, id: number | string): Promise<void> => {
  await req.payload.update({ collection: 'workspaces', id, data: { gatewayKey: encrypt(newKey()) }, overrideAccess: true, req })
  await ensureKey(req, id)
}

export const deleteKey = async (slug: string): Promise<void> => {
  for (const name of [keyName(slug), sessionKeyName(slug), routerKeyName(slug)]) {
    const existing = await keyNamed(name)
    if (existing) await call('DELETE', `${KEYS}/${existing.id}`)
  }
}

const cache = new Map<string, { at: number; v: { spentUsd: number; limitUsd: number | null } }>()

/** Spend over the rolling 30 d (gateway request_logs) and the limit; cached for 60 s. */
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

/** Writes the Connection's provider credential as a 0600 file the gateway reads (`apiKey.file`, `auth.gcp.credential.file`). */
export const writeProvider = async (ws: string, conn: string, secret: string, ext: 'key' | 'json' = 'key'): Promise<void> => {
  await mkdir(join(dir(), 'providers'), { recursive: true })
  const tmp = `${providerFile(ws, conn, ext)}.tmp`
  await writeFile(tmp, secret, { mode: 0o600 })
  await rename(tmp, providerFile(ws, conn, ext))
}

export const removeProvider = (ws: string, conn: string, ...exts: ('key' | 'json')[]) =>
  Promise.all((exts.length ? exts : (['key', 'json'] as const)).map((e) => rm(providerFile(ws, conn, e), { force: true })))

/** Removes every provider file of a Workspace (its Connections are gone with it). */
export const removeWorkspaceProviders = async (ws: string): Promise<void> => {
  const files = await readdir(join(dir(), 'providers')).catch(() => [] as string[])
  await Promise.all(files.filter((f) => f.startsWith(`ws-${ws}.`) && /^[a-z0-9-]+\.(key|json)$/.test(f.slice(`ws-${ws}.`.length))).map((f) => rm(join(dir(), 'providers', f), { force: true })))
}

/** Which router categories (MMLU domains of the router's built-in classifier) go to which tier; everything else takes `cheap`. */
const ROUTER_DOMAINS = {
  strong: ['math', 'physics', 'chemistry', 'engineering', 'law'],
  standard: ['computer science', 'business', 'economics', 'health', 'biology'],
}

/**
 * Writes `/gateway/router/config.yaml` (0600, holds the router key) for the vLLM Semantic Router while a `router` Connection exists; removes it with the last one.
 * The gateway is the router's only backend; categories map to the Workspace's tier models, the inner calls carry the router key (never the Workspace key).
 */
export const renderRouter = async (req: PayloadRequest): Promise<void> => {
  const path = join(dir(), 'router', 'config.yaml')
  // Filtered here, not in SQL (see tierModels): older migrations render the gateway before the `router` enum value exists.
  const conn = ((await req.payload.find({ collection: 'connections', where: { kind: { equals: 'llm-provider' } }, sort: 'id', depth: 0, pagination: false, overrideAccess: true, req })).docs as Record<string, any>[]).find((c) => c.provider === 'router')
  if (!conn) return void (await rm(path, { force: true }))
  const ws = await loadWs(req, typeof conn.workspace === 'object' ? (conn.workspace as { id: number }).id : (conn.workspace as number))
  if (!ws.routerKey) {
    req.payload.logger.error(`renderRouter: Workspace ${ws.slug} has no router key, router config not written`)
    return void (await rm(path, { force: true }))
  }
  const { auto: _auto, ...tiers } = await tierModels(req.payload, ws, req)
  const backend = { name: 'gateway', endpoint: 'gateway:4000', protocol: 'http', provider: 'vllm', auth_header: 'Authorization', auth_prefix: 'Bearer', api_key: decrypt(ws.routerKey) }
  const cfg = {
    version: 'v0.3',
    listeners: [{ name: 'http-8801', address: '0.0.0.0', port: 8801, timeout: '300s' }],
    providers: {
      defaults: { model: tiers.cheap },
      models: [...new Set(Object.values(tiers))].map((id) => ({ name: id, provider_model_id: id, api_format: 'openai', backend_refs: [backend] })),
    },
    routing: {
      strategy: 'priority',
      signals: { domains: Object.entries(ROUTER_DOMAINS).map(([name, mmlu_categories]) => ({ name, description: `${name} tier categories`, mmlu_categories })) },
      decisions: (['strong', 'standard'] as const).map((name, i) => ({
        name,
        priority: 200 - i * 100,
        rules: { operator: 'AND', conditions: [{ type: 'domain', name }] },
        modelRefs: [{ model: tiers[name], use_reasoning: false }],
        algorithm: { type: 'static' },
      })),
    },
    global: { router: { config_source: 'file', auto_model_names: ['auto'] } },
  }
  const tmp = `${path}.tmp`
  await rm(tmp, { force: true })
  await writeSecretFile(tmp, stringify(cfg))
  await rename(tmp, path)
}

/** Rewrites (0600, inline secrets live here) the managed `ws-<slug>/<connection>/*` entries of `llm.models` (one per llm-provider Connection, rendered by its preset) and `modelCatalog` (every file in `catalogs/`); keeps the rest (e.g. `sub/*`). */
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
  const slugs = new Map(
    (await req.payload.find({ collection: 'workspaces', select: { slug: true }, depth: 0, pagination: false, overrideAccess: true, req })).docs.map((w) => [w.id, w.slug as string] as const),
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
  const path = join(dir(), 'config.yaml')
  const cfg = parse(await readFile(path, 'utf8'))
  const kept = ((cfg.llm?.models ?? []) as { name: string }[]).filter((m) => !m.name.startsWith('ws-'))
  cfg.llm = { ...cfg.llm, models: [...kept, ...models] }
  const catalogs = (await readdir(join(dir(), 'catalogs')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort()
  if (catalogs.length) cfg.config = { ...cfg.config, modelCatalog: catalogs.map((f) => ({ file: join(dir(), 'catalogs', f) })) }
  const out = stringify(cfg)
  const tmp = `${path}.tmp`
  await rm(tmp, { force: true })
  await writeSecretFile(tmp, out)
  await rename(tmp, path)
  await renderRouter(req)
}

/** One Messages call as the Workspace on its `cheap` tier (the key's budget applies); throws on any non-2xx. */
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

/** One 1-token request through the local gateway as the Workspace; retries while the config hot-reloads. Returns the capability patch, never the response body. */
export const verifyProvider = async (slug: string, key: string, model: string /* `<connection>/<model>` */): Promise<{ verifiedAt: string } | { lastError: string }> => {
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
