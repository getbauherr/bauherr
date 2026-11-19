import type { Check, Forge } from '@bauherr/adapters'
import { ValidationError } from 'payload'
import { budgetStatus, DEFAULT_MODEL_BY_TIER, gatewayEnabled } from '../../../lib/gateway'
import { PRESETS, presetOf } from '../../../lib/providers'
import { modelOptions } from './models'
import { loadModelList } from '../../../lib/prices'
import { blockedBy } from '../../../lib/settings-guards'
import { formatPathSets } from '../../../lib/path-sets'
import { backendFor } from '../../../lib/adapters'
import { connectionInput } from '../../../lib/connection'
import { forgeOf } from '../../../lib/forge'
import { setupOf } from './product-setup'
import { payloadClient, workspacesOf, type Bauherr } from './session'

export type FormState = { saved?: boolean; error?: string; fields?: Record<string, string>; notice?: string }

export async function run(fn: () => Promise<string | void>, rename: Record<string, string> = {}): Promise<FormState> {
  try {
    const notice = await fn()
    return { saved: true, notice: notice || undefined }
  } catch (e) {
    if (String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) throw e
    const errors = (e as { data?: { errors?: { path: string; message: string }[] } }).data?.errors
    if (e instanceof ValidationError || errors) {
      const fields = Object.fromEntries((errors ?? []).map((x) => [rename[x.path] ?? x.path, x.message]))
      const n = Object.keys(fields).length
      return { fields, error: n ? (n === 1 ? '1 field needs attention' : `${n} fields need attention`) : (e as Error).message }
    }
    return { error: (e as Error).message }
  }
}

export const connectionPresets = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { required: v.required, hint: v.secret.hint }]))

export const isAdmin = (u: Bauherr) => u.role === 'admin'
export const only = (u: Bauherr) => {
  if (!isAdmin(u)) throw new Error('Only an Admin can change this.')
}

const o = { overrideAccess: true, depth: 0 } as const

export async function presetFor(workspace: number) {
  const { docs } = await (await payloadClient()).find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', pagination: false, select: { config: true, slug: true }, ...o } as never)
  const conns = docs as unknown as { config?: never; slug: string }[]
  return { ...PRESETS[presetOf(conns[0]?.config)], key: presetOf(conns[0]?.config), slugs: conns.map((c) => c.slug) }
}

export async function loadWorkspaceSettings(id: number) {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id, select: { gatewayKey: false }, ...o } as never)) as unknown as Record<string, any>
  const preset = await presetFor(id)
  const modelByTier0 = (ws.modelByTier ?? {}) as Record<string, string>
  const modelChoices = modelOptions(preset.key, preset.defaultModels ? Object.values(preset.defaultModels) : [], await loadModelList(payload), Object.values(modelByTier0).map((v) => (preset.slugs[0] && v.startsWith(`${preset.slugs[0]}/`) ? v.slice(preset.slugs[0].length + 1) : v)))
  const spend = gatewayEnabled() && process.env.GATEWAY_DATABASE_URL ? await budgetStatus(ws.slug).catch(() => null) : null
  return {
    name: ws.name as string,
    slug: ws.slug as string,
    budgetUnit: (ws.budgetUnit ?? 'usd') as 'usd' | 'tokens',
    budgetUsd30d: ws.budgetUsd30d as number | null,
    budgetTokens30d: ws.budgetTokens30d as number | null,
    modelByTier: Object.fromEntries(Object.entries((ws.modelByTier ?? {}) as Record<string, string>).map(([t, v]) => [t, preset.slugs[0] && v.startsWith(`${preset.slugs[0]}/`) ? v.slice(preset.slugs[0].length + 1) : v])),
    modelChoices,
    placeholders: preset.defaultModels ?? DEFAULT_MODEL_BY_TIER,
    tiersRequired: !preset.defaultModels,
    spend,
    gatewayOn: gatewayEnabled(),
  }
}

export async function loadProducts(workspace: number) {
  const payload = await payloadClient()
  const where = { workspace: { equals: workspace } }
  const find = async (collection: string, extra: object = {}) => (await payload.find({ collection, where, sort: 'id', ...o, pagination: false, ...extra } as never)).docs as unknown as Record<string, any>[]
  const [products, repositories, sources, connections] = await Promise.all([find('products'), find('repositories'), find('ticket_sources', { depth: 1 }), find('connections', { select: { secret: false } })])
  return {
    connections: connections.filter((c) => c.kind === 'github' || c.kind === 'gitlab').map((c) => ({ id: c.id as number, name: c.name as string })),
    products: await Promise.all(
      products.map(async (p) => {
        const product = {
          id: p.id as number,
          name: p.name as string,
          slug: p.slug as string,
          deploy: { stagingUrl: (p.stagingUrl ?? '') as string, mode: (p.deployMode ?? 'observe-ci') as string, webhookUrl: (p.deployWebhookUrl ?? '') as string, checks: (p.deployChecks ?? '') as string, productionGate: !!p.productionGate, productionWebhookUrl: (p.productionWebhookUrl ?? '') as string, productionChecks: (p.productionChecks ?? '') as string },
          pathSetsText: formatPathSets(p.pathSets),
          blocked: await blockedBy(payload, 'products', p.id),
          repositories: repositories.filter((r) => r.product === p.id).map((r) => ({ id: r.id as number, fullName: r.fullName as string })),
          sources: sources
            .filter((s) => (s.product?.id ?? s.product) === p.id)
            .map((s) => ({ id: s.id as number, repo: s.repo as string, connection: (s.connection?.name ?? '') as string, cursor: (s.cursor ?? '') as string, polledAt: s.updatedAt as string })),
        }
        return { ...product, setup: setupOf(product) }
      }),
    ),
  }
}

export async function loadProduct(workspace: number, id: number) {
  const { products, connections } = await loadProducts(workspace)
  const product = products.find((p) => p.id === id)
  return product ? { product, connections } : undefined
}

export type RecentCheck = { name: string; seen: number; of: number; lastConclusion: string }

const RECENT_COMMITS = 5
const MAX_COMMITS_READ = 10

export async function collectChecks(forge: Forge, repo: string, extraShas: string[], timeoutMs = 3000): Promise<RecentCheck[] | null> {
  const read = async () => {
    const { defaultBranch } = await forge.getRepository(repo)
    const head = (await forge.listBranches(repo)).find((b) => b.name === defaultBranch)?.sha
    const newest = head ? (await forge.listCommits(repo, { to: head })).slice(0, RECENT_COMMITS).map((c) => c.sha) : []
    const shas = [...new Set([...newest, ...extraShas])].slice(0, MAX_COMMITS_READ)
    const runs = (await Promise.all(shas.map((sha) => forge.listChecks(repo, sha).catch(() => null)))).filter((r): r is Check[] => r !== null)
    if (shas.length && !runs.length) return null
    const byName = new Map<string, RecentCheck>()
    for (const checks of runs) {
      const latest = new Map<string, Check>()
      for (const c of checks) if (!latest.has(c.name) || (c.id ?? 0) >= (latest.get(c.name)!.id ?? 0)) latest.set(c.name, c)
      for (const [name, c] of latest) {
        const seen = byName.get(name)
        byName.set(name, { name, seen: (seen?.seen ?? 0) + 1, of: runs.length, lastConclusion: seen?.lastConclusion ?? c.conclusion ?? c.status })
      }
    }
    return [...byName.values()].sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([read(), new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)))])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function recentChecks(productId: number): Promise<RecentCheck[] | null> {
  try {
    const { backend, repo } = await forgeOf(await payloadClient(), productId)
    return await collectChecks(backend.forge, repo, [])
  } catch {
    return null
  }
}

export async function loadConnections(workspace: number) {
  const payload = await payloadClient()
  const where = { workspace: { equals: workspace } }
  const [{ docs }, sources] = await Promise.all([
    payload.find({ collection: 'connections', where, sort: 'id', select: { secret: false }, ...o, pagination: false } as never),
    payload.find({ collection: 'ticket_sources', where: { and: [where, { lastPolledAt: { exists: true } }, { lastError: { exists: false } }] }, select: { connection: true, lastError: true }, ...o, pagination: false } as never),
  ])
  const polled = new Set((sources.docs as unknown as Record<string, any>[]).filter((s) => !s.lastError).map((s) => s.connection?.id ?? s.connection))
  return (docs as unknown as Record<string, any>[]).map((c) => ({
      inUse: polled.has(c.id),
      id: c.id as number,
      name: c.name as string,
      kind: c.kind as string,
      provider: c.kind === 'llm-provider' ? presetOf(c.config) : '',
      config: Object.fromEntries(['baseUrl', 'awsRegion', 'vertexProject', 'vertexRegion', 'azureResource'].map((k) => [k, (c.config?.[k] ?? '') as string])),
      status: (c.capabilities?.lastError ? 'failed' : c.capabilities?.verifiedAt ? 'ok' : 'none') as 'failed' | 'ok' | 'none',
      detail: (c.capabilities?.lastError ?? c.capabilities?.verifiedAt ?? '') as string,
    }))
}

export async function loadAssignable(workspaces: { id: number; name: string }[]) {
  const { docs } = await (await payloadClient()).find({ collection: 'products', where: { workspace: { in: workspaces.map((w) => w.id) } }, sort: 'name', pagination: false, select: { name: true, workspace: true }, ...o } as never)
  const products = docs as unknown as { id: number; name: string; workspace: number }[]
  return workspaces.map((w) => ({ id: w.id, name: w.name, products: products.filter((p) => p.workspace === w.id).map(({ id, name }) => ({ id, name })) }))
}

export async function loadBauherren(user: Bauherr, workspace: number | null) {
  const admin = isAdmin(user)
  if (!admin && workspace == null) return []
  const own = admin ? [] : (await workspacesOf(user)).map((w) => w.id)
  const where = admin ? {} : { 'tenants.tenant': { equals: workspace } }
  const { docs } = await (await payloadClient()).find({ collection: 'bauherren', where, sort: 'email', ...o, depth: 1, pagination: false, showHiddenFields: true } as never)
  return (docs as unknown as Record<string, any>[]).map((b) => ({
    id: b.id as number,
    email: b.email as string,
    role: b.role as string,
    workspaces: ((b.tenants ?? []) as { tenant: { id: number; name: string } | number }[])
      .flatMap((t) => (typeof t.tenant === 'object' && t.tenant ? [t.tenant] : []))
      .filter((w) => admin || own.includes(w.id)),
    assignments: ((b.assignments ?? []) as { workspace: { id: number; name: string } | number; scope: 'workspace' | 'products'; products?: ({ id: number; name: string } | number)[] }[])
      .flatMap((a) => (typeof a.workspace === 'object' && a.workspace && (admin || own.includes(a.workspace.id)) ? [{ workspace: a.workspace, scope: a.scope, products: (a.products ?? []).flatMap((p) => (typeof p === 'object' ? [p] : [])) }] : [])),
    locked: !!b.lockUntil && new Date(b.lockUntil as string).getTime() > Date.now(),
    githubLogin: (b.githubLogin ?? '') as string,
    oidcLinked: !!b.oidcSubject,
    oidcSubject: admin ? ((b.oidcSubject ?? '') as string) : '',
  }))
}

type Doc = Record<string, any>

export async function loadAudit(workspace: number, f: { actor?: string }) {
  const where: Doc = { workspace: { equals: workspace } }
  if (f.actor) where.actor = { like: f.actor.replace(/[\\%_]/g, '\\$&') }
  const { docs } = await (await payloadClient()).find({ collection: 'human_touches', where, sort: '-createdAt', limit: 200, pagination: false, ...o } as never)
  return (docs as unknown as Doc[]).map((d) => ({ id: d.id as number, at: (d.at ?? d.createdAt) as string, kind: (d.kind ?? '') as string, actor: (d.actor ?? '') as string }))
}

export async function loadHealth(workspace: number) {
  const payload = await payloadClient()
  const day = { greater_than_equal: new Date(Date.now() - 864e5).toISOString() }
  const count = async (where: Doc) => (await payload.count({ collection: 'payload-jobs', where: { createdAt: day, ...where }, ...o } as never)).totalDocs
  const [queued, running, failed, oldest, sources] = await Promise.all([
    count({ completedAt: { exists: false }, processing: { not_equals: true }, hasError: { not_equals: true } }),
    count({ processing: { equals: true }, completedAt: { exists: false } }),
    count({ hasError: { equals: true } }),
    payload.find({ collection: 'payload-jobs', where: { createdAt: { greater_than_equal: new Date(Date.now() - 7 * 864e5).toISOString() }, completedAt: { exists: false }, processing: { not_equals: true }, hasError: { not_equals: true } }, sort: 'createdAt', limit: 1, pagination: false, select: { createdAt: true }, ...o } as never),
    payload.find({ collection: 'ticket_sources', where: { workspace: { equals: workspace } }, sort: 'id', pagination: false, select: { repo: true, lastPolledAt: true, lastError: true }, ...o } as never),
  ])
  return {
    queued,
    running,
    failed,
    oldestQueued: ((oldest.docs[0] as Doc | undefined)?.createdAt ?? null) as string | null,
    sources: (sources.docs as unknown as Doc[]).map((s) => ({ repo: s.repo as string, polledAt: (s.lastPolledAt ?? null) as string | null, error: (s.lastError ?? null) as string | null })),
  }
}

const REPO_LIST_MS = 3000

export async function listRepos(connectionId: number): Promise<string[] | null> {
  try {
    const conn = await connectionInput(await payloadClient(), connectionId)
    const timeout = new Promise<never>((_, reject) => AbortSignal.timeout(REPO_LIST_MS).addEventListener('abort', () => reject(new Error('timeout'))))
    const repos = await Promise.race([backendFor(conn, { maxRetries: 0, timeoutMs: REPO_LIST_MS }).forge.listRepositories(), timeout])
    return repos.map((r) => r.fullName).sort()
  } catch {
    return null
  }
}
