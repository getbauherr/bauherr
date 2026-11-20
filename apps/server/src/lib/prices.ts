import { live } from './workspace-delete'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { syncManagedConfig, tierModels } from './gateway'
import {
  type Catalog,
  convertCatalog,
  type ListedModel,
  priceChanges,
  type PriceChange,
  refusal,
} from './price-catalog'

export { convertCatalog, refusal } from './price-catalog'

const modelName = (m: string | null | undefined): string =>
  (m ?? '')
    .replace(/\[.*\]$/, '')
    .split('/')
    .pop() || 'unknown'

export const PRICES_URL = 'https://raw.githubusercontent.com/agentgateway/agentgateway/main/catalog/model-catalog.json'
export const BASE_FILE = 'base-costs.json'
const MAX_BYTES = 5_000_000

export type PriceStatus = {
  fetchedAt: string
  attemptedAt: string
  source: string
  generatedAt: string | null
  models: number
  error: { at: string; message: string } | null
  changed?: PriceChange[]
  version: number
}

export const pricesEnabled = (): boolean => process.env.BAUHERR_PRICES_REFRESH !== '0'
export const pricesUrl = (): string => process.env.BAUHERR_PRICES_URL || PRICES_URL
const dir = (): string => join(process.env.GATEWAY_CONFIG_DIR ?? '/gateway', 'catalogs')

const getState = async <T>(payload: Payload, key: string): Promise<T | null> =>
  ((
    await payload.find({
      collection: 'instance_state',
      where: { key: { equals: key } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
  ).docs[0]?.value as T | undefined) ?? null
export const setState = async (payload: Payload, key: string, value: unknown): Promise<void> => {
  await payload.db.drizzle.execute(
    sql`INSERT INTO "instance_state" ("key", "value") VALUES (${key}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`,
  )
}
export const loadPriceStatus = (payload: Payload): Promise<PriceStatus | null> =>
  getState<PriceStatus>(payload, 'prices')
export const loadModelList = async (payload: Payload): Promise<ListedModel[]> =>
  (await getState<ListedModel[]>(payload, 'price-models')) ?? []

const readCatalog = async (path: string): Promise<Catalog | undefined> => {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Catalog
  } catch {
    return undefined
  }
}

const previous = async (): Promise<Catalog | undefined> =>
  (await readCatalog(join(dir(), BASE_FILE))) ??
  (await readCatalog(join(dir(), 'anthropic.json'))) ??
  (await readCatalog(resolve(process.cwd(), '../../deploy/gateway/catalogs/anthropic.json')))

export const modelsInUse = async (payload: Payload): Promise<string[]> => {
  const out = new Set<string>()
  const workspaces = (
    await payload.find({
      collection: 'workspaces',
      where: live,
      pagination: false,
      depth: 0,
      overrideAccess: true,
      select: { slug: true, modelByTier: true },
    })
  ).docs as { id: number; slug: string; modelByTier?: Record<string, string> | null }[]
  for (const ws of workspaces) {
    try {
      for (const m of Object.values(await tierModels(payload, ws))) out.add(modelName(m))
    } catch {
      for (const m of Object.values(ws.modelByTier ?? {})) out.add(modelName(m))
    }
  }
  return [...out]
}

const REFRESH_EVERY_MS = 24 * 3_600_000
const RETRY_EVERY_MS = 3_600_000

const isFresh = (before: PriceStatus, now: number): boolean =>
  !before.error
    ? now - Date.parse(before.fetchedAt) < REFRESH_EVERY_MS
    : now - Date.parse(before.attemptedAt) < RETRY_EVERY_MS

type Failure = (message: string) => Promise<PriceStatus>

const failureRecorder =
  (payload: Payload, before: PriceStatus | null, source: string, stamp: string): Failure =>
  async (message) => {
    const status: PriceStatus = {
      fetchedAt: before?.fetchedAt ?? '',
      attemptedAt: stamp,
      source,
      generatedAt: before?.generatedAt ?? null,
      models: before?.models ?? 0,
      error: { at: stamp, message },
      ...(before?.changed && { changed: before.changed }),
      version: 1,
    }
    await setState(payload, 'prices', status)
    payload.logger.warn({ source, message }, 'price refresh failed')
    return status
  }

const download = async (url: string, source: string, fetcher: typeof fetch): Promise<{ text: string } | string> => {
  try {
    const res = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return `${source} answered HTTP ${res.status}`
    const tooLarge = `the catalog is larger than ${MAX_BYTES / 1e6} MB`
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return tooLarge
    const text = await res.text()
    return text.length > MAX_BYTES ? tooLarge : { text }
  } catch {
    return `${source} could not be reached`
  }
}

const convertDownloaded = (text: string): ReturnType<typeof convertCatalog> | string => {
  try {
    return convertCatalog(JSON.parse(text))
  } catch (e) {
    return e instanceof SyntaxError ? 'the answer is not JSON' : (e as Error).message
  }
}

const fetchCatalog = async (
  url: string,
  source: string,
  fetcher: typeof fetch,
): Promise<ReturnType<typeof convertCatalog> | string> => {
  const downloaded = await download(url, source, fetcher)
  return typeof downloaded === 'string' ? downloaded : convertDownloaded(downloaded.text)
}

const storeCatalog = async (catalog: Catalog): Promise<void> => {
  await mkdir(dir(), { recursive: true })
  const path = join(dir(), BASE_FILE)
  const tmp = `${path}.tmp`
  await rm(tmp, { force: true })
  await writeFile(tmp, JSON.stringify(catalog), { mode: 0o644 })
  await rename(tmp, path)
}

const recordSuccess = async (
  payload: Payload,
  converted: ReturnType<typeof convertCatalog>,
  prev: Catalog | undefined,
  source: string,
  stamp: string,
): Promise<PriceStatus> => {
  const status: PriceStatus = {
    fetchedAt: stamp,
    attemptedAt: stamp,
    source,
    generatedAt: converted.catalog.metadata.generatedAt,
    models: converted.list.length,
    error: null,
    changed: priceChanges(prev, converted.catalog, await modelsInUse(payload).catch(() => [])),
    version: 1,
  }
  await setState(
    payload,
    'price-models',
    converted.list.map(({ provider, id, name, deprecated }) => ({ provider, id, name, deprecated })),
  )
  await setState(payload, 'prices', status)
  payload.logger.info({ models: status.models, source }, 'price refresh')
  return status
}

export const refreshPrices = async (
  payload: Payload,
  o: { force?: boolean; now?: number; fetcher?: typeof fetch } = {},
): Promise<PriceStatus | null> => {
  if (!pricesEnabled()) return loadPriceStatus(payload)
  const now = o.now ?? Date.now()
  const before = await loadPriceStatus(payload)
  if (!o.force && before && isFresh(before, now)) return before
  const url = pricesUrl()
  const source = new URL(url).host
  const stamp = new Date(now).toISOString()
  const fail = failureRecorder(payload, before, source, stamp)
  const converted = await fetchCatalog(url, source, o.fetcher ?? fetch)
  if (typeof converted === 'string') return fail(converted)
  const prev = await previous()
  const why = refusal(prev, converted.catalog)
  if (why) return fail(why)
  await storeCatalog(converted.catalog)
  await syncManagedConfig().catch((e) =>
    payload.logger.warn({ err: e }, 'listing the price catalog in the gateway config failed'),
  )
  return recordSuccess(payload, converted, prev, source, stamp)
}
