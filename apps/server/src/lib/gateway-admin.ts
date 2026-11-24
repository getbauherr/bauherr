import { randomBytes } from 'node:crypto'
import pg from 'pg'
import type { PayloadRequest } from 'payload'
import { envInt } from './db-pool'
import { writeSecretFile } from './gateway-files'
import { decrypt, encrypt } from './secrets'

type Ws = {
  id: number | string
  slug: string
  gatewayKey?: string | null
  budgetUsd30d?: number | null
  budgetUnit?: string | null
  budgetTokens30d?: number | null
}
type Resource = {
  id: string
  value: { key: string; metadata?: { name?: string; kind?: string }; budgets?: { limit: { amount: number } }[] }
}

export const newKey = (): string => `sk-bauherr-${randomBytes(24).toString('hex')}`
export const keyName = (slug: string) => `workspace-${slug}`
const sessionKeyName = (slug: string) => `${keyName(slug)}-session`
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
  const base = tokens ? (ws.budgetTokens30d ?? 20_000_000) : (ws.budgetUsd30d ?? 50)
  return [
    {
      name: 'monthly',
      limit: { unit: tokens ? 'Tokens' : 'USD', amount: base },
      window: { rolling: '30d' },
      onBudgetExceeded: 'Block',
    },
  ]
}

const loadWs = async (req: PayloadRequest, id: number | string): Promise<Ws> =>
  (await req.payload.findByID({ collection: 'workspaces', id, depth: 0, overrideAccess: true, req })) as Ws

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
    budgets: [
      {
        name: 'monthly',
        limit: { unit: 'USD', amount: envInt(process.env, 'SESSION_BUDGET_USD', 100) },
        window: { rolling: '30d' },
        onBudgetExceeded: 'Audit',
      },
    ],
  }
  if (existing) await call('PUT', `${KEYS}/${existing.id}`, { value })
  else await call('PUT', KEYS, { resources: [{ value }] })
  if (process.env.BAUHERR_SESSION_KEY_FILE) await writeSecretFile(process.env.BAUHERR_SESSION_KEY_FILE, value.key)
  return value.key
}

export const rotateSessionKey = async (req: PayloadRequest, id: number | string): Promise<string> =>
  ensureSessionKey(await loadWs(req, id), true)

export const rotateKey = async (req: PayloadRequest, id: number | string): Promise<void> => {
  await req.payload.update({
    collection: 'workspaces',
    id,
    data: { gatewayKey: encrypt(newKey()) },
    overrideAccess: true,
    req,
  })
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
    const r = await db.query<{ spent: unknown }>(
      `SELECT COALESCE(SUM(cost), 0) AS spent FROM request_logs WHERE agentgateway_user = $1 ` +
        `AND completed_at > now() - interval '30 days'`,
      [keyName(slug)],
    )
    const limit = await keyOf(slug)
    const v = { spentUsd: Number(r.rows[0]?.spent), limitUsd: limit?.value.budgets?.[0]?.limit.amount ?? null }
    cache.set(slug, { at: Date.now(), v })
    return v
  } finally {
    await db.end()
  }
}
