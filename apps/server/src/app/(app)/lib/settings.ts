import { type Payload, ValidationError } from 'payload'
import { budgetStatus, DEFAULT_MODEL_BY_TIER, gatewayEnabled } from '../../../lib/gateway'
import { PRESETS, presetOf } from '../../../lib/providers'
import { modelOptions } from './models'
import { loadModelList } from '../../../lib/prices'
import { blockedBy, recordCountOf } from '../../../lib/settings-guards'
import { formatPathSets, type PathSets } from '../../../lib/path-sets'
import { backendFor } from '../../../lib/adapters'
import { connectionInput } from '../../../lib/connection'
import { setupOf } from './product-setup'
import { payloadClient } from './session'

export { loadAudit, loadHealth } from './settings-diagnostics'
export { loadBauherren } from './settings-people'
export { isAdmin, only } from './settings-admin'

export type FormState = { saved?: boolean; error?: string; fields?: Record<string, string>; notice?: string }

type FieldError = { path: string; message: string }

const failureState = (e: unknown, rename: Record<string, string>): FormState => {
  const errors = (e as { data?: { errors?: FieldError[] } }).data?.errors
  if (!(e instanceof ValidationError || errors)) return { error: (e as Error).message }
  const fields = Object.fromEntries((errors ?? []).map((x) => [rename[x.path] ?? x.path, x.message]))
  const n = Object.keys(fields).length
  return {
    fields,
    error: n ? (n === 1 ? '1 field needs attention' : `${n} fields need attention`) : (e as Error).message,
  }
}

export async function run(fn: () => Promise<string | void>, rename: Record<string, string> = {}): Promise<FormState> {
  try {
    const notice = await fn()
    return { saved: true, notice: notice || undefined }
  } catch (e) {
    if (String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) throw e
    return failureState(e, rename)
  }
}

export const connectionPresets = Object.fromEntries(
  Object.entries(PRESETS).map(([k, v]) => [k, { required: v.required, hint: v.secret.hint }]),
)

const o = { overrideAccess: true, depth: 0 } as const

export async function presetFor(workspace: number) {
  const { docs } = await (
    await payloadClient()
  ).find({
    collection: 'connections',
    where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } },
    sort: 'id',
    pagination: false,
    select: { config: true, slug: true },
    ...o,
  })
  const conns = docs as { config?: { provider?: string } | null; slug: string }[]
  return { ...PRESETS[presetOf(conns[0]?.config)], key: presetOf(conns[0]?.config), slugs: conns.map((c) => c.slug) }
}

type WorkspaceDoc = {
  id: number
  name: string
  slug: string
  budgetUnit?: 'usd' | 'tokens' | null
  budgetUsd30d: number | null
  budgetTokens30d: number | null
  modelByTier?: Record<string, string> | null
}

export async function loadWorkspaceSettings(id: number) {
  const payload = await payloadClient()
  const ws = (await payload.findByID({
    collection: 'workspaces',
    id,
    select: { gatewayKey: false },
    ...o,
  })) as WorkspaceDoc
  const preset = await presetFor(id)
  const modelByTier0 = ws.modelByTier ?? {}
  const modelChoices = modelOptions(
    preset.key,
    preset.defaultModels ? Object.values(preset.defaultModels) : [],
    await loadModelList(payload),
    Object.values(modelByTier0).map((v) =>
      preset.slugs[0] && v.startsWith(`${preset.slugs[0]}/`) ? v.slice(preset.slugs[0].length + 1) : v,
    ),
  )
  const spend =
    gatewayEnabled() && process.env.GATEWAY_DATABASE_URL ? await budgetStatus(ws.slug).catch(() => null) : null
  return {
    name: ws.name,
    slug: ws.slug,
    budgetUnit: ws.budgetUnit ?? 'usd',
    budgetUsd30d: ws.budgetUsd30d,
    budgetTokens30d: ws.budgetTokens30d,
    modelByTier: Object.fromEntries(
      Object.entries(ws.modelByTier ?? {}).map(([t, v]) => [
        t,
        preset.slugs[0] && v.startsWith(`${preset.slugs[0]}/`) ? v.slice(preset.slugs[0].length + 1) : v,
      ]),
    ),
    modelChoices,
    placeholders: preset.defaultModels ?? DEFAULT_MODEL_BY_TIER,
    tiersRequired: !preset.defaultModels,
    spend,
    gatewayOn: gatewayEnabled(),
  }
}

type ProductDoc = {
  id: number
  name: string
  slug: string
  stagingUrl?: string | null
  productionGate?: boolean | null
  pathSets?: PathSets | null
  state?: string
}
type RepositoryDoc = { id: number; product: number; fullName: string }
type SourceDoc = {
  id: number
  product?: { id: number } | number
  repo: string
  connection?: { name?: string } | number | null
  cursor?: string | null
  updatedAt: string
}
type ConnectionDoc = {
  id: number
  name: string
  kind: string
  config?: Record<string, string | undefined> | null
  capabilities?: { lastError?: string; verifiedAt?: string } | null
}

const inWorkspace = <T>(
  payload: Payload,
  collection: 'products' | 'repositories' | 'ticket_sources' | 'connections',
  workspace: number,
  extra: { depth?: number; select?: { secret: false } } = {},
) =>
  payload
    .find({
      collection,
      where: { workspace: { equals: workspace } },
      sort: 'id',
      ...o,
      pagination: false,
      ...extra,
    })
    .then((r) => r.docs as T[])

const productRow = async (payload: Payload, p: ProductDoc, repositories: RepositoryDoc[], sources: SourceDoc[]) => {
  const product = {
    id: p.id,
    name: p.name,
    slug: p.slug,
    deploy: { stagingUrl: p.stagingUrl ?? '', productionGate: !!p.productionGate },
    pathSetsText: formatPathSets(p.pathSets),
    state: p.state === 'active' ? ('active' as const) : ('observing' as const),
    tickets: await recordCountOf(payload, p.id),
    blocked: await blockedBy(payload, 'products', p.id),
    repositories: repositories.filter((r) => r.product === p.id).map((r) => ({ id: r.id, fullName: r.fullName })),
    sources: sources
      .filter((s) => (typeof s.product === 'object' ? s.product.id : s.product) === p.id)
      .map((s) => ({
        id: s.id,
        repo: s.repo,
        connection: (typeof s.connection === 'object' && s.connection?.name) || '',
        cursor: s.cursor ?? '',
        polledAt: s.updatedAt,
      })),
  }
  return { ...product, setup: setupOf(product) }
}

export async function loadProducts(workspace: number) {
  const payload = await payloadClient()
  const [products, repositories, sources, connections] = await Promise.all([
    inWorkspace<ProductDoc>(payload, 'products', workspace),
    inWorkspace<RepositoryDoc>(payload, 'repositories', workspace),
    inWorkspace<SourceDoc>(payload, 'ticket_sources', workspace, { depth: 1 }),
    inWorkspace<ConnectionDoc>(payload, 'connections', workspace, { select: { secret: false } }),
  ])
  return {
    connections: connections
      .filter((c) => c.kind === 'github' || c.kind === 'gitlab')
      .map((c) => ({ id: c.id, name: c.name })),
    products: await Promise.all(products.map((p) => productRow(payload, p, repositories, sources))),
  }
}

const CONNECTION_CONFIG_KEYS = [
  'baseUrl',
  'appId',
  'installationId',
  'awsRegion',
  'vertexProject',
  'vertexRegion',
  'azureResource',
]

const verificationOf = (c: ConnectionDoc) => ({
  status: c.capabilities?.lastError
    ? ('failed' as const)
    : c.capabilities?.verifiedAt
      ? ('ok' as const)
      : ('none' as const),
  detail: c.capabilities?.lastError ?? c.capabilities?.verifiedAt ?? '',
})

export async function loadConnections(workspace: number) {
  const payload = await payloadClient()
  const where = { workspace: { equals: workspace } }
  const [docs, sources] = await Promise.all([
    inWorkspace<ConnectionDoc>(payload, 'connections', workspace, { select: { secret: false } }),
    payload.find({
      collection: 'ticket_sources',
      where: { and: [where, { lastPolledAt: { exists: true } }, { lastError: { exists: false } }] },
      select: { connection: true, lastError: true },
      ...o,
      pagination: false,
    }),
  ])
  const polled = new Set(
    (sources.docs as { lastError?: string | null; connection?: { id: number } | number | null }[])
      .filter((s) => !s.lastError)
      .map((s) => (typeof s.connection === 'object' && s.connection ? s.connection.id : s.connection)),
  )
  return docs.map((c) => ({
    inUse: polled.has(c.id),
    id: c.id,
    name: c.name,
    kind: c.kind,
    provider: c.kind === 'llm-provider' ? presetOf(c.config) : '',
    config: Object.fromEntries(CONNECTION_CONFIG_KEYS.map((k) => [k, c.config?.[k] ?? ''])),
    ...verificationOf(c),
  }))
}

export async function loadAssignable(workspaces: { id: number; name: string }[]) {
  const { docs } = await (
    await payloadClient()
  ).find({
    collection: 'products',
    where: { workspace: { in: workspaces.map((w) => w.id) } },
    sort: 'name',
    pagination: false,
    select: { name: true, workspace: true },
    ...o,
  })
  const products = docs as { id: number; name: string; workspace: number }[]
  return workspaces.map((w) => ({
    id: w.id,
    name: w.name,
    products: products.filter((p) => p.workspace === w.id).map(({ id, name }) => ({ id, name })),
  }))
}

const REPO_LIST_MS = 3000

export async function listRepos(connectionId: number): Promise<string[] | null> {
  try {
    const conn = await connectionInput(await payloadClient(), connectionId)
    const timeout = new Promise<never>((_, reject) =>
      AbortSignal.timeout(REPO_LIST_MS).addEventListener('abort', () => reject(new Error('timeout'))),
    )
    const repos = await Promise.race([
      backendFor(conn, { maxRetries: 0, timeoutMs: REPO_LIST_MS }).forge.listRepositories(),
      timeout,
    ])
    return repos.map((r) => r.fullName).sort()
  } catch {
    return null
  }
}
