import { randomUUID } from 'node:crypto'
import { readdir, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { sql } from '@payloadcms/db-postgres'
import type { PayloadRequest } from 'payload'
import { parse, stringify } from 'yaml'
import { dir, providerFile, writeSecretFile } from './gateway-files'
import { KEY_HEADERS, PRESETS, presetOf } from './providers'
import { decrypt } from './secrets'

export const KEY_LOCATION =
  'coalesce(request.headers["x-agw-key"], request.headers["x-api-key"], ' +
  'request.headers["x-goog-api-key"], request.headers["authorization"].stripPrefix("Bearer "))'
const OLD_KEY_LOCATION =
  'coalesce(request.headers["x-agw-key"], request.headers["authorization"].stripPrefix("Bearer "))'

export const SESSION_LOG_FIELDS = {
  session: 'request.headers["x-bauherr-session"]',
  role: 'request.headers["x-bauherr-role"]',
  client: 'coalesce(request.headers["x-bauherr-client"], request.headers["user-agent"])',
} as const

type Model = { name: string; transformation?: unknown; requestHeaders?: { remove?: string[] } }
type GatewayConfig = {
  frontendPolicies?: {
    tracing?: Record<string, unknown>
    accessLog?: { database?: { add?: Record<string, string> } }
  }
  llm?: { models?: Model[]; policies?: { apiKey?: { location?: { expression?: string } } } }
  config?: Record<string, unknown>
}

const applyTracing = (cfg: GatewayConfig, tracing: Record<string, unknown> | null | undefined): void => {
  if (tracing === undefined) return
  const policies = (cfg.frontendPolicies ??= {})
  if (tracing) policies.tracing = tracing
  else delete policies.tracing
}

const addSessionLogFields = (cfg: GatewayConfig): void => {
  const log = ((((cfg.frontendPolicies ??= {}).accessLog ??= {}).database ??= {}).add ??= {})
  for (const [k, v] of Object.entries(SESSION_LOG_FIELDS)) log[k] ??= v
}

const stripKeyHeaders = (models: Model[]): void => {
  for (const m of models.filter((x) => x.name === 'sub/*'))
    m.requestHeaders = {
      ...m.requestHeaders,
      remove: [...new Set([...(m.requestHeaders?.remove ?? []), ...KEY_HEADERS])],
    }
}

const addClaudeModel = (models: Model[]): void => {
  const sub = models.find((m) => m.name === 'sub/*')
  if (!sub || models.some((m) => m.name === 'claude-*')) return
  const rest = structuredClone(sub)
  delete rest.transformation
  models.splice(models.indexOf(sub) + 1, 0, { ...rest, name: 'claude-*' })
}

export const ensureManaged = (
  cfg: GatewayConfig,
  catalogFiles: string[],
  tracing?: Record<string, unknown> | null,
): boolean => {
  const before = JSON.stringify(cfg)
  applyTracing(cfg, tracing)
  addSessionLogFields(cfg)
  const models = cfg.llm?.models ?? []
  const location = cfg.llm?.policies?.apiKey?.location
  if (location?.expression === OLD_KEY_LOCATION) location.expression = KEY_LOCATION
  stripKeyHeaders(models)
  addClaudeModel(models)
  if (catalogFiles.length)
    cfg.config = { ...cfg.config, modelCatalog: catalogFiles.map((f) => ({ file: join(dir(), 'catalogs', f) })) }
  return JSON.stringify(cfg) !== before
}

const catalogFiles = async (): Promise<string[]> =>
  (await readdir(join(dir(), 'catalogs')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).sort()

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
    const cfg = parse(await readFile(path, 'utf8').catch(() => '')) as GatewayConfig | null
    if (!cfg || typeof cfg !== 'object' || !ensureManaged(cfg, await catalogFiles(), tracing)) return false
    await writeConfig(path, cfg)
    return true
  })

const archivedIds = async (req: PayloadRequest): Promise<(number | string)[]> => {
  const has = (
    await req.payload.db.drizzle.execute(
      sql`SELECT 1 FROM information_schema.columns
        WHERE table_name = 'workspaces' AND column_name = 'archived_at' AND table_schema = current_schema()`,
    )
  ).rows.length
  if (!has) return []
  return (
    await req.payload.find({
      collection: 'workspaces',
      where: { archivedAt: { exists: true } },
      select: {},
      pagination: false,
      depth: 0,
      overrideAccess: true,
      req,
    })
  ).docs.map((w) => w.id)
}

type ConnectionDoc = { id: number | string; workspace: number; slug?: string | null; config: unknown; secret?: string }

const renderEntry = (c: ConnectionDoc, slugs: Map<number | string, string>) => {
  const slug = slugs.get(c.workspace)
  const conn = c.slug
  const cfg = c.config as Record<string, string> | null
  const def = PRESETS[presetOf(cfg)]
  const secret = def.auth === 'inline' && c.secret ? decrypt(c.secret) : undefined
  if (!slug || !conn || (def.auth === 'inline' && !secret)) return []
  return [
    {
      key: `${slug}/${conn}`,
      entry: def.render(`${slug}/${conn}`, cfg ?? {}, providerFile(slug, conn, def.secret.ext), secret) as Model,
    },
  ]
}

const renderableModels = async (req: PayloadRequest) => {
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
    (
      await req.payload.find({
        collection: 'workspaces',
        select: { slug: true },
        depth: 0,
        pagination: false,
        overrideAccess: true,
        req,
      })
    ).docs
      .filter((w) => !gone.includes(w.id))
      .map((w) => [w.id, w.slug as string] as const),
  )
  return conns.docs
    .flatMap((c) => {
      try {
        return renderEntry(c as ConnectionDoc, slugs)
      } catch {
        req.payload.logger.error(`renderModels: skipped Connection ${c.id}, stored provider config is invalid`)
        return []
      }
    })
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => m.entry)
}

export const renderModels = async (req: PayloadRequest): Promise<void> => {
  const models = await renderableModels(req)
  await withConfig(async () => {
    const path = join(dir(), 'config.yaml')
    const cfg = parse(await readFile(path, 'utf8')) as GatewayConfig
    const kept = (cfg.llm?.models ?? []).filter((m) => !m.name.startsWith('ws-'))
    cfg.llm = { ...cfg.llm, models: [...kept, ...models] }
    ensureManaged(cfg, await catalogFiles())
    await writeConfig(path, cfg)
  })
}
