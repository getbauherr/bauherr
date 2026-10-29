import { randomBytes } from 'node:crypto'
import { chown, mkdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import pg from 'pg'
import type { PayloadRequest } from 'payload'
import { parse, stringify } from 'yaml'
import { decrypt, encrypt } from './secrets'

export const DEFAULT_MODEL_BY_TIER = { cheap: 'claude-haiku-5-5', standard: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' }

type Ws = { id: number | string; slug: string; gatewayKey?: string | null; budgetUsd30d?: number | null }
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
const dir = () => process.env.GATEWAY_CONFIG_DIR ?? '/gateway'
const providerFile = (slug: string) => join(dir(), 'providers', `ws-${slug}.key`)
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

const budget = (ws: Ws) => [
  { name: 'monthly', limit: { unit: 'USD', amount: ws.budgetUsd30d ?? 50 }, window: { rolling: '30d' }, onBudgetExceeded: 'Block' },
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
}

/**
 * Second consumer key per Workspace for the owner's own Claude Code session (`sub/*` only, see docs/legal.md).
 * The value lives in the gateway only; an existing key is reused. With BAUHERR_SESSION_KEY_FILE set it is written there (0600).
 */
export const ensureSessionKey = async (ws: Ws): Promise<void> => {
  const existing = await keyNamed(sessionKeyName(ws.slug))
  const value = {
    key: existing?.value.key ?? newKey(),
    metadata: { name: sessionKeyName(ws.slug), user: keyName(ws.slug), kind: 'owner-session' },
    allowedModels: ['sub/*'],
    budgets: budget(ws),
  }
  if (existing) await call('PUT', `${KEYS}/${existing.id}`, { value })
  else await call('PUT', KEYS, { resources: [{ value }] })
  if (process.env.BAUHERR_SESSION_KEY_FILE) await writeSecretFile(process.env.BAUHERR_SESSION_KEY_FILE, value.key)
}

/** Replaces the Workspace key; the old key stops working. */
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

/** Writes the provider credential as a 0600 file the gateway reads (`params.apiKey.file`). */
export const writeProvider = async (slug: string, secret: string): Promise<void> => {
  await mkdir(join(dir(), 'providers'), { recursive: true })
  const tmp = `${providerFile(slug)}.tmp`
  await writeFile(tmp, secret, { mode: 0o600 })
  await rename(tmp, providerFile(slug))
}

export const removeProvider = (slug: string) => rm(providerFile(slug), { force: true })

/** Rewrites the managed `ws-<slug>/*` entries of `llm.models` (one per anthropic llm-provider Connection), keeps the rest (e.g. `sub/*`). */
export const renderModels = async (req: PayloadRequest): Promise<void> => {
  const conns = await req.payload.find({
    collection: 'connections',
    where: { kind: { equals: 'llm-provider' } },
    depth: 1,
    pagination: false,
    overrideAccess: true,
    req,
  })
  const slugs = conns.docs
    .filter((c) => ((c.config as { provider?: string } | null)?.provider ?? 'anthropic') === 'anthropic')
    .map((c) => (c.workspace as unknown as Ws | undefined)?.slug)
    .filter((s): s is string => !!s)
    .sort()
  const models = slugs.map((slug) => ({
    name: `ws-${slug}/*`,
    provider: 'anthropic',
    params: { apiKey: { file: providerFile(slug) } },
    transformation: { model: `llmRequest.model.stripPrefix("ws-${slug}/")` },
  }))
  const path = join(dir(), 'config.yaml')
  const cfg = parse(await readFile(path, 'utf8'))
  const kept = ((cfg.llm?.models ?? []) as { name: string }[]).filter((m) => !m.name.startsWith('ws-'))
  cfg.llm = { ...cfg.llm, models: [...kept, ...models] }
  const out = stringify(cfg)
  const tmp = `${path}.tmp`
  await writeFile(tmp, out)
  await rename(tmp, path)
}
