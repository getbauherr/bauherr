import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { modelName, priceOf, reloadCatalog } from './cost'
import { workflowFor } from './factory'
import { syncManagedConfig, tierModels } from './gateway'

/** The catalog agentgateway publishes (https://agentgateway.dev/model-catalog redirects here; the fetch refuses redirects, so the final address is the default). */
export const PRICES_URL = 'https://raw.githubusercontent.com/agentgateway/agentgateway/main/catalog/model-catalog.json'
export const BASE_FILE = 'base-costs.json'
/** The refreshed file is a base catalog (newest `metadata.generatedAt` wins in the gateway); the shipped overlays stay. */
const MAX_BYTES = 5_000_000
export const MIN_MODELS = 300
/** A refresh that loses more than this share of the models, or moves a known price by more than this factor, is refused. */
export const MIN_KEPT = 0.7
export const MAX_FACTOR = 10
const MAX_RATE = 10_000
const SERVICE_TIERS = ['standard', 'flex', 'priority', 'reserved']
const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/

type Rates = Partial<Record<(typeof RATE_KEYS)[number], string>> & { cacheWriteDetails?: Record<string, string> }
type Model = { name?: string; rates: Rates; tiers?: { contextOver?: number; serviceTier?: string; rates: Rates }[] }
export type Catalog = { metadata: { generatedAt: string }; providers: Record<string, { models: Record<string, Model> }> }
/** One entry of the model list shown in Settings: provider, id, display name, whether the source marks it deprecated. */
export type ListedModel = { provider: string; id: string; name: string; deprecated: boolean }
/** A model the instance uses (a tier or role model of any Workspace) whose price moved in a refresh; `[old, new]` USD per million tokens. */
export type PriceChange = { model: string; input?: [string, string]; output?: [string, string] }
export type PriceStatus = { fetchedAt: string; attemptedAt: string; source: string; generatedAt: string | null; models: number; error: { at: string; message: string } | null; changed?: PriceChange[]; version: number }

export const pricesEnabled = (): boolean => process.env.BAUHERR_PRICES_REFRESH !== '0'
export const pricesUrl = (): string => process.env.BAUHERR_PRICES_URL || PRICES_URL
const dir = (): string => join(process.env.GATEWAY_CONFIG_DIR ?? '/gateway', 'catalogs')

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const rate = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v)) return undefined
  const n = Number(v)
  return n <= MAX_RATE ? v : undefined
}

const ratesOf = (v: unknown): Rates | undefined => {
  if (!isObj(v)) return undefined
  const out: Rates = {}
  for (const k of RATE_KEYS) {
    const r = rate(v[k])
    if (r !== undefined) out[k] = r
  }
  if (out.input === undefined || out.output === undefined) return undefined
  if (isObj(v.cacheWriteDetails)) {
    const d = Object.fromEntries(Object.entries(v.cacheWriteDetails).filter(([k, x]) => (k === '1h' || k === '12h') && rate(x) !== undefined)) as Record<string, string>
    if (Object.keys(d).length) out.cacheWriteDetails = d
  }
  return out
}

/**
 * Validates the source catalog and rewrites it to what the pinned gateway reads: only name, text rates and the tiers it understands (a tier with a context threshold or a known service tier).
 * v1.7.0 refuses a whole file with one unknown enum value (the published catalog already has `serviceTier: "fast"`), so everything else is dropped.
 * Throws on a shape that is not a catalog; skips single entries that are malformed.
 */
export const convertCatalog = (raw: unknown): { catalog: Catalog; list: ListedModel[] } => {
  if (!isObj(raw) || !isObj(raw.providers)) throw new Error('not a model catalog: "providers" is missing')
  const generatedAt = isObj(raw.metadata) && typeof raw.metadata.generatedAt === 'string' ? raw.metadata.generatedAt : ''
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error('not a model catalog: "metadata.generatedAt" is missing')
  const providers: Catalog['providers'] = {}
  const list: ListedModel[] = []
  for (const [prov, pv] of Object.entries(raw.providers)) {
    if (!NAME.test(prov) || !isObj(pv) || !isObj(pv.models)) continue
    const models: Record<string, Model> = {}
    for (const [id, mv] of Object.entries(pv.models)) {
      if (!NAME.test(id) || !isObj(mv)) continue
      const rates = ratesOf(mv.rates)
      if (!rates) continue
      const tiers = (Array.isArray(mv.tiers) ? mv.tiers : []).flatMap((t) => {
        if (!isObj(t)) return []
        const r = ratesOf(t.rates)
        const over = typeof t.contextOver === 'number' && Number.isFinite(t.contextOver) ? t.contextOver : undefined
        const svc = typeof t.serviceTier === 'string' && SERVICE_TIERS.includes(t.serviceTier) ? t.serviceTier : undefined
        return r && (t.serviceTier === undefined ? over !== undefined : svc !== undefined) ? [{ ...(over !== undefined && { contextOver: over }), ...(svc && { serviceTier: svc }), rates: r }] : []
      })
      const name = typeof mv.name === 'string' ? mv.name.slice(0, 120) : id
      models[id] = { name, rates, ...(tiers.length && { tiers }) }
      list.push({ provider: prov, id, name, deprecated: mv.status === 'deprecated' })
    }
    if (Object.keys(models).length) providers[prov] = { models }
  }
  return { catalog: { metadata: { generatedAt }, providers }, list }
}

const count = (c: Catalog): number => Object.values(c.providers).reduce((n, p) => n + Object.keys(p.models).length, 0)

/** Why `next` must not replace `prev`, or null: too few models, too many gone, or a known price moved by an implausible factor. */
export const refusal = (prev: Catalog | undefined, next: Catalog): string | null => {
  const n = count(next)
  if (n < MIN_MODELS) return `the catalog lists only ${n} models (minimum ${MIN_MODELS}); kept the previous prices`
  if (!prev) return null
  const was = count(prev)
  if (n < was * MIN_KEPT) return `the catalog dropped from ${was} to ${n} models; kept the previous prices`
  const moved: string[] = []
  for (const [prov, p] of Object.entries(prev.providers)) {
    for (const [id, m] of Object.entries(p.models)) {
      const now = next.providers[prov]?.models[id]
      if (!now) continue
      for (const k of ['input', 'output'] as const) {
        const a = Number(m.rates[k])
        const b = Number(now.rates[k])
        if (a > 0 && b > 0 && (b / a > MAX_FACTOR || a / b > MAX_FACTOR)) moved.push(`${prov}/${id}`)
      }
    }
  }
  return moved.length ? `prices moved by more than ${MAX_FACTOR}x for ${[...new Set(moved)].slice(0, 3).join(', ')}${moved.length > 3 ? ' and more' : ''}; kept the previous prices` : null
}

const getState = async <T>(payload: Payload, key: string): Promise<T | null> => ((await payload.find({ collection: 'instance_state', where: { key: { equals: key } }, limit: 1, depth: 0, overrideAccess: true })).docs[0]?.value as T | undefined) ?? null
/** Upserts an instance state value (jobs only; no API access). */
export const setState = async (payload: Payload, key: string, value: unknown): Promise<void> => {
  await payload.db.drizzle.execute(sql`INSERT INTO "instance_state" ("key", "value") VALUES (${key}, ${JSON.stringify(value)}::jsonb) ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`)
}
export const loadPriceStatus = (payload: Payload): Promise<PriceStatus | null> => getState<PriceStatus>(payload, 'prices')
export const loadModelList = async (payload: Payload): Promise<ListedModel[]> => (await getState<ListedModel[]>(payload, 'price-models')) ?? []

/**
 * Prices that had no catalog entry when they were logged: priced now that the catalog knows the model.
 * Only rows with tokens and no cost are touched, so a price the gateway computed is never overwritten.
 */
export const repriceUnpriced = async (payload: Payload): Promise<number> => {
  const rows = (await payload.db.drizzle.execute(sql`SELECT "id", "model", COALESCE("tokens_in", 0)::float8 AS tin, COALESCE("tokens_out", 0)::float8 AS tout, COALESCE("cache_read", 0)::float8 AS cr, COALESCE("cache_write", 0)::float8 AS cw FROM "usage_entries" WHERE "cost_usd" IS NULL AND COALESCE("tokens_in", 0) + COALESCE("tokens_out", 0) > 0 AND "source" <> 'chat' ORDER BY "id" LIMIT 5000`)).rows as { id: number; model: string; tin: number; tout: number; cr: number; cw: number }[]
  let done = 0
  for (const r of rows) {
    const cost = priceOf(r.model, { tokensIn: r.tin, tokensOut: r.tout, cacheRead: r.cr, cacheWrite: r.cw })
    if (cost == null) continue
    await payload.db.drizzle.execute(sql`UPDATE "usage_entries" SET "cost_usd" = ${cost}, "updated_at" = now() WHERE "id" = ${r.id} AND "cost_usd" IS NULL`)
    done++
  }
  return done
}

const readCatalog = async (path: string): Promise<Catalog | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Catalog
  } catch {
    return undefined
  }
}

/** The previous base catalog: the last refresh, else (first refresh) the shipped base catalog, so a first update is checked and compared the same way. */
const previous = async (): Promise<Catalog | undefined> =>
  (await readCatalog(join(dir(), BASE_FILE))) ?? (await readCatalog(join(dir(), 'anthropic.json'))) ?? (await readCatalog(resolve(process.cwd(), '../../deploy/gateway/catalogs/anthropic.json')))

const FIRST_PARTY = ['anthropic', 'openai', 'gcp.gemini', 'mistral', 'xai', 'deepseek']
const rateOf = (c: Catalog | undefined, model: string): Rates | undefined => {
  const hits = Object.entries(c?.providers ?? {}).filter(([, p]) => p.models[model]).sort(([a], [b]) => (FIRST_PARTY.indexOf(a) + 1 || 99) - (FIRST_PARTY.indexOf(b) + 1 || 99))
  return hits[0]?.[1].models[model]?.rates
}

/** Tier and role models of every Workspace, as bare model names. */
export const modelsInUse = async (payload: Payload): Promise<string[]> => {
  const out = new Set<string>()
  const workspaces = (await payload.find({ collection: 'workspaces', pagination: false, depth: 0, overrideAccess: true, select: { slug: true, modelByTier: true } })).docs as unknown as { id: number; slug: string; modelByTier?: Record<string, string> | null }[]
  for (const ws of workspaces) {
    try {
      for (const m of Object.values(await tierModels(payload, ws as never))) out.add(modelName(m))
    } catch {
      for (const m of Object.values(ws.modelByTier ?? {})) out.add(modelName(m))
    }
    try {
      for (const r of workflowFor(ws.id).roles) if (r.model) out.add(modelName(r.model))
    } catch {
      // workflows not loaded: tier models still count
    }
  }
  return [...out]
}

/** Models in `used` whose input or output price differs between the two catalogs. */
export const priceChanges = (prev: Catalog | undefined, next: Catalog, used: string[]): PriceChange[] =>
  used.flatMap((model) => {
    const a = rateOf(prev, model)
    const b = rateOf(next, model)
    if (!a || !b) return []
    const diff = (k: 'input' | 'output'): [string, string] | undefined => (Number(a[k]) !== Number(b[k]) ? [String(Number(a[k])), String(Number(b[k]))] : undefined)
    const input = diff('input')
    const output = diff('output')
    return input || output ? [{ model, ...(input && { input }), ...(output && { output }) }] : []
  })

const REFRESH_EVERY_MS = 24 * 3_600_000
const RETRY_EVERY_MS = 3_600_000

/**
 * Fetches the price catalog from the one configured URL (default the catalog agentgateway publishes), converts and checks it, writes `catalogs/base-costs.json` atomically
 * (the gateway watches the directory and reloads without a restart), stores the model list and the status, then prices what was unpriced.
 * A bad answer keeps the previous file and stores the error. `force` ignores the daily pace (Update now). Never executes anything from the source: it is parsed as JSON and rewritten field by field.
 */
export const refreshPrices = async (payload: Payload, o: { force?: boolean; now?: number; fetcher?: typeof fetch } = {}): Promise<PriceStatus | null> => {
  if (!pricesEnabled()) return loadPriceStatus(payload)
  const now = o.now ?? Date.now()
  const before = await loadPriceStatus(payload)
  if (!o.force && before) {
    const age = now - Date.parse(before.fetchedAt)
    const tried = now - Date.parse(before.attemptedAt)
    if (!before.error ? age < REFRESH_EVERY_MS : tried < RETRY_EVERY_MS) return before
  }
  const url = pricesUrl()
  const source = new URL(url).host
  const stamp = new Date(now).toISOString()
  const fail = async (message: string): Promise<PriceStatus> => {
    const status: PriceStatus = { fetchedAt: before?.fetchedAt ?? '', attemptedAt: stamp, source, generatedAt: before?.generatedAt ?? null, models: before?.models ?? 0, error: { at: stamp, message }, ...(before?.changed && { changed: before.changed }), version: 1 }
    await setState(payload, 'prices', status)
    payload.logger.warn({ source, message }, 'price refresh failed')
    return status
  }
  let text: string
  try {
    const res = await (o.fetcher ?? fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } })
    if (!res.ok) return fail(`${source} answered HTTP ${res.status}`)
    const length = Number(res.headers.get('content-length') ?? 0)
    if (length > MAX_BYTES) return fail(`the catalog is larger than ${MAX_BYTES / 1e6} MB`)
    text = await res.text()
    if (text.length > MAX_BYTES) return fail(`the catalog is larger than ${MAX_BYTES / 1e6} MB`)
  } catch {
    return fail(`${source} could not be reached`)
  }
  let converted: ReturnType<typeof convertCatalog>
  try {
    converted = convertCatalog(JSON.parse(text))
  } catch (e) {
    return fail(e instanceof SyntaxError ? 'the answer is not JSON' : (e as Error).message)
  }
  const prev = await previous()
  const why = refusal(prev, converted.catalog)
  if (why) return fail(why)
  await mkdir(dir(), { recursive: true })
  const path = join(dir(), BASE_FILE)
  const tmp = `${path}.tmp`
  await rm(tmp, { force: true })
  await writeFile(tmp, JSON.stringify(converted.catalog), { mode: 0o644 })
  await rename(tmp, path)
  reloadCatalog()
  await syncManagedConfig().catch((e) => payload.logger.warn({ err: e }, 'listing the price catalog in the gateway config failed'))
  const status: PriceStatus = { fetchedAt: stamp, attemptedAt: stamp, source, generatedAt: converted.catalog.metadata.generatedAt, models: converted.list.length, error: null, changed: priceChanges(prev, converted.catalog, await modelsInUse(payload).catch(() => [])), version: 1 }
  await setState(payload, 'price-models', converted.list.map(({ provider, id, name, deprecated }) => ({ provider, id, name, deprecated })))
  await setState(payload, 'prices', status)
  const repriced = await repriceUnpriced(payload)
  payload.logger.info({ models: status.models, repriced, source }, 'price refresh')
  return status
}
