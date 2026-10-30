import { ValidationError } from 'payload'
import { budgetStatus, DEFAULT_MODEL_BY_TIER, gatewayEnabled } from '../../../lib/gateway'
import { PRESETS, presetOf } from '../../../lib/providers'
import { payloadClient, type Bauherr } from './session'

export type FormState = { saved?: boolean; error?: string; fields?: Record<string, string>; notice?: string }

/** Runs a settings write; Payload's ValidationError becomes per-field messages, anything else one error line. `rename` maps Payload paths to form field names. */
export async function run(fn: () => Promise<string | void>, rename: Record<string, string> = {}): Promise<FormState> {
  try {
    const notice = await fn()
    return { saved: true, notice: notice || undefined }
  } catch (e) {
    const errors = (e as { data?: { errors?: { path: string; message: string }[] } }).data?.errors
    if (e instanceof ValidationError || errors) {
      const fields = Object.fromEntries((errors ?? []).map((x) => [rename[x.path] ?? x.path, x.message]))
      return { fields, error: Object.keys(fields).length ? undefined : (e as Error).message }
    }
    return { error: (e as Error).message }
  }
}

export const isAdmin = (u: Bauherr) => u.role === 'admin'
export const only = (u: Bauherr) => {
  if (!isAdmin(u)) throw new Error('Only an Admin can change this.')
}

const o = { overrideAccess: true, depth: 0 } as const
const count = async (collection: string, where: Record<string, unknown>) => (await (await payloadClient()).count({ collection, where, overrideAccess: true } as never)).totalDocs

export type Refs = { product: Record<number, string>; connection: Record<number, string> }
const why = (parts: [number, string][]) => parts.filter(([n]) => n).map(([n, s]) => `${n} ${s}`).join(', ')

/** Plain-language reason a Product or Connection cannot be deleted yet; empty when nothing references it. */
export async function blockedBy(collection: 'products' | 'connections', id: number): Promise<string> {
  if (collection === 'connections') return why([[await count('ticket_sources', { connection: { equals: id } }), 'ticket sources']])
  return why([
    [await count('repositories', { product: { equals: id } }), 'repositories'],
    [await count('ticket_sources', { product: { equals: id } }), 'ticket sources'],
    [await count('tickets', { product: { equals: id } }), 'tickets'],
  ])
}

export async function loadWorkspaceSettings(id: number) {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id, depth: 0, overrideAccess: true })) as unknown as Record<string, any>
  const { docs } = await payload.find({ collection: 'connections', where: { workspace: { equals: id }, kind: { equals: 'llm-provider' } }, limit: 1, ...o })
  const preset = PRESETS[presetOf(docs[0]?.config as never)]
  const spend = gatewayEnabled() && process.env.GATEWAY_DATABASE_URL ? await budgetStatus(ws.slug).catch(() => null) : null
  return {
    name: ws.name as string,
    slug: ws.slug as string,
    budgetUnit: (ws.budgetUnit ?? 'usd') as 'usd' | 'tokens',
    budgetUsd30d: ws.budgetUsd30d as number | null,
    budgetTokens30d: ws.budgetTokens30d as number | null,
    modelByTier: (ws.modelByTier ?? {}) as Record<string, string>,
    defaultMode: (ws.defaultMode ?? '') as string,
    modeByStage: (ws.modeByStage ?? {}) as Record<string, string>,
    placeholders: preset.defaultModels ?? DEFAULT_MODEL_BY_TIER,
    spend,
    gatewayOn: gatewayEnabled(),
  }
}

export async function loadProducts(workspace: number) {
  const payload = await payloadClient()
  const where = { workspace: { equals: workspace } }
  const find = async (collection: string, extra: object = {}) => (await payload.find({ collection, where, sort: 'id', ...o, pagination: false, ...extra } as never)).docs as unknown as Record<string, any>[]
  const [products, repositories, sources, connections] = await Promise.all([find('products'), find('repositories'), find('ticket_sources', { depth: 1 }), find('connections')])
  return {
    connections: connections.filter((c) => c.kind === 'github').map((c) => ({ id: c.id as number, name: c.name as string })),
    products: await Promise.all(
      products.map(async (p) => ({
        id: p.id as number,
        name: p.name as string,
        slug: p.slug as string,
        blocked: await blockedBy('products', p.id),
        repositories: repositories.filter((r) => r.product === p.id).map((r) => ({ id: r.id as number, fullName: r.fullName as string })),
        sources: sources
          .filter((s) => (s.product?.id ?? s.product) === p.id)
          .map((s) => ({ id: s.id as number, repo: s.repo as string, connection: (s.connection?.name ?? '') as string, cursor: (s.cursor ?? '') as string, polledAt: s.updatedAt as string })),
      })),
    ),
  }
}

export async function loadConnections(workspace: number) {
  const { docs } = await (await payloadClient()).find({ collection: 'connections', where: { workspace: { equals: workspace } }, sort: 'id', ...o, pagination: false } as never)
  return Promise.all(
    (docs as unknown as Record<string, any>[]).map(async (c) => ({
      id: c.id as number,
      name: c.name as string,
      kind: c.kind as string,
      provider: c.kind === 'llm-provider' ? presetOf(c.config) : '',
      config: Object.fromEntries(['baseUrl', 'awsRegion', 'vertexProject', 'vertexRegion', 'azureResource'].map((k) => [k, (c.config?.[k] ?? '') as string])),
      status: (c.capabilities?.lastError ? 'failed' : c.capabilities?.verifiedAt ? 'ok' : 'none') as 'failed' | 'ok' | 'none',
      detail: (c.capabilities?.lastError ?? c.capabilities?.verifiedAt ?? '') as string,
      blocked: await blockedBy('connections', c.id),
    })),
  )
}

export async function loadBauherren(user: Bauherr, workspace: number | null) {
  const where = isAdmin(user) ? {} : { 'tenants.tenant': { equals: workspace } }
  const { docs } = await (await payloadClient()).find({ collection: 'bauherren', where, sort: 'email', ...o, depth: 1, pagination: false } as never)
  return (docs as unknown as Record<string, any>[]).map((b) => ({
    id: b.id as number,
    email: b.email as string,
    role: b.role as string,
    workspaces: ((b.tenants ?? []) as { tenant: { id: number; name: string } | number }[]).flatMap((t) => (typeof t.tenant === 'object' && t.tenant ? [t.tenant] : [])),
    oidcSubject: (b.oidcSubject ?? '') as string,
    oidcSynced: (b.oidcSynced ?? '') as string,
  }))
}
