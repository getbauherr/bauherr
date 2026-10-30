import { ValidationError } from 'payload'
import { budgetStatus, DEFAULT_MODEL_BY_TIER, gatewayEnabled } from '../../../lib/gateway'
import { modeFor, workflowPack } from '../../../lib/mode'
import { PRESETS, presetOf } from '../../../lib/providers'
import { blockedBy } from '../../../lib/settings-guards'
import { payloadClient, workspacesOf, type Bauherr } from './session'

export type FormState = { saved?: boolean; error?: string; fields?: Record<string, string>; notice?: string }

/** Runs a settings write; Payload's ValidationError becomes per-field messages, anything else one error line. `rename` maps Payload paths to form field names. */
export async function run(fn: () => Promise<string | void>, rename: Record<string, string> = {}): Promise<FormState> {
  try {
    const notice = await fn()
    return { saved: true, notice: notice || undefined }
  } catch (e) {
    if (String((e as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) throw e
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

/** The preset of the Workspace's llm-provider Connection (anthropic when it has none). */
export async function presetFor(workspace: number) {
  const { docs } = await (await payloadClient()).find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, limit: 1, select: { config: true }, ...o } as never)
  return PRESETS[presetOf((docs[0] as unknown as { config?: never } | undefined)?.config)]
}

export async function loadWorkspaceSettings(id: number) {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id, select: { gatewayKey: false }, ...o } as never)) as unknown as Record<string, any>
  const preset = await presetFor(id)
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
    connections: connections.filter((c) => c.kind === 'github').map((c) => ({ id: c.id as number, name: c.name as string })),
    products: await Promise.all(
      products.map(async (p) => ({
        id: p.id as number,
        name: p.name as string,
        slug: p.slug as string,
        blocked: await blockedBy(payload, 'products', p.id),
        repositories: repositories.filter((r) => r.product === p.id).map((r) => ({ id: r.id as number, fullName: r.fullName as string })),
        sources: sources
          .filter((s) => (s.product?.id ?? s.product) === p.id)
          .map((s) => ({ id: s.id as number, repo: s.repo as string, connection: (s.connection?.name ?? '') as string, cursor: (s.cursor ?? '') as string, polledAt: s.updatedAt as string })),
      })),
    ),
  }
}

export async function loadConnections(workspace: number) {
  const { docs } = await (await payloadClient()).find({ collection: 'connections', where: { workspace: { equals: workspace } }, sort: 'id', select: { secret: false }, ...o, pagination: false } as never)
  return (docs as unknown as Record<string, any>[]).map((c) => ({
      id: c.id as number,
      name: c.name as string,
      kind: c.kind as string,
      provider: c.kind === 'llm-provider' ? presetOf(c.config) : '',
      config: Object.fromEntries(['baseUrl', 'awsRegion', 'vertexProject', 'vertexRegion', 'azureResource'].map((k) => [k, (c.config?.[k] ?? '') as string])),
      status: (c.capabilities?.lastError ? 'failed' : c.capabilities?.verifiedAt ? 'ok' : 'none') as 'failed' | 'ok' | 'none',
      detail: (c.capabilities?.lastError ?? c.capabilities?.verifiedAt ?? '') as string,
    }))
}

/** Admin: everyone, with SSO details. Others: only Bauherren sharing the current Workspace, SSO as a flag, Workspaces reduced to the viewer's own. */
export async function loadBauherren(user: Bauherr, workspace: number | null) {
  const admin = isAdmin(user)
  if (!admin && workspace == null) return []
  const own = admin ? [] : (await workspacesOf(user)).map((w) => w.id)
  const where = admin ? {} : { 'tenants.tenant': { equals: workspace } }
  const { docs } = await (await payloadClient()).find({ collection: 'bauherren', where, sort: 'email', ...o, depth: 1, pagination: false } as never)
  return (docs as unknown as Record<string, any>[]).map((b) => ({
    id: b.id as number,
    email: b.email as string,
    role: b.role as string,
    workspaces: ((b.tenants ?? []) as { tenant: { id: number; name: string } | number }[])
      .flatMap((t) => (typeof t.tenant === 'object' && t.tenant ? [t.tenant] : []))
      .filter((w) => admin || own.includes(w.id)),
    oidcLinked: !!b.oidcSubject,
    oidcSubject: admin ? ((b.oidcSubject ?? '') as string) : '',
  }))
}

type Doc = Record<string, any>
const ref = (v: any) => (v && typeof v === 'object' ? (v as Doc) : null)

/** Newest 200 rows of the Workspace's audit trail. `ticket` is the Ticket number, `run` a Run id; `actor` applies to human touches only. */
export async function loadAudit(workspace: number, tab: 'touches' | 'calls', f: { ticket?: string; run?: string; actor?: string }) {
  const payload = await payloadClient()
  const where: Doc = { workspace: { equals: workspace } }
  if (Number(f.run)) where.run = { equals: Number(f.run) }
  if (Number(f.ticket)) where[tab === 'touches' ? 'ticket.number' : 'run.ticket.number'] = { equals: Number(f.ticket) }
  if (tab === 'touches' && f.actor) where.actor = { like: f.actor }
  const { docs } = await payload.find({ collection: tab === 'touches' ? 'human_touches' : 'tool_calls', where, sort: '-createdAt', limit: 200, depth: 2, pagination: false, overrideAccess: true } as never)
  return (docs as unknown as Doc[]).map((d) => {
    const run = ref(d.run)
    const ticket = ref(tab === 'touches' ? d.ticket : run?.ticket)
    return {
      id: d.id as number,
      at: (d.at ?? d.createdAt) as string,
      kind: (d.kind ?? d.name) as string,
      actor: (d.actor ?? '') as string,
      status: (d.status ?? '') as string,
      durationMs: d.durationMs as number | null,
      digest: (d.inputDigest ?? '') as string,
      runId: (run?.id ?? d.run ?? null) as number | null,
      ticket: ticket ? { id: ticket.id as number, number: ticket.number as number } : null,
    }
  })
}

/** Base workflow with the mode each stage resolves to in this Workspace, plus the latest compiled version per Product. */
export async function loadWorkflow(workspace: number) {
  const payload = await payloadClient()
  const base = workflowPack()
  const stages = await Promise.all(base.map(async (s) => ({ name: s.name, mode: await modeFor(payload, workspace, s.name), gate: s.gate_before ?? '', steps: (s.steps ?? []).map((x) => (x.skill ? `${x.kind}: ${x.skill}` : x.kind)) })))
  const where = { workspace: { equals: workspace } }
  const [products, versions] = await Promise.all([
    payload.find({ collection: 'products', where, sort: 'name', pagination: false, ...o } as never),
    payload.find({ collection: 'workflow_versions', where, sort: '-version', pagination: false, ...o } as never),
  ])
  const baseJson = JSON.stringify({ stages: base })
  return {
    stages,
    versions: (products.docs as unknown as Doc[]).map((p) => {
      const v = (versions.docs as unknown as Doc[]).find((x) => (ref(x.product)?.id ?? x.product) === p.id)
      return { product: p.name as string, version: (v?.version ?? null) as number | null, at: (v?.createdAt ?? null) as string | null, overlay: v ? JSON.stringify(v.compiled) !== baseJson : false }
    }),
  }
}

/** Factory health: instance-wide job counts of the last 24 h, the oldest queued job, last poll per Ticket source of the Workspace. */
export async function loadHealth(workspace: number) {
  const payload = await payloadClient()
  const since = new Date(Date.now() - 864e5).toISOString()
  const jobs = (await payload.find({ collection: 'payload-jobs', where: { createdAt: { greater_than: since } }, select: { completedAt: true, hasError: true, processing: true }, pagination: false, ...o } as never)).docs as unknown as Doc[]
  const oldest = (await payload.find({ collection: 'payload-jobs', where: { completedAt: { exists: false }, processing: { not_equals: true }, hasError: { not_equals: true } }, sort: 'createdAt', limit: 1, select: { createdAt: true }, ...o } as never)).docs[0] as Doc | undefined
  const sources = (await payload.find({ collection: 'ticket_sources', where: { workspace: { equals: workspace } }, sort: 'id', pagination: false, select: { repo: true, updatedAt: true }, ...o } as never)).docs as unknown as Doc[]
  return {
    queued: jobs.filter((j) => !j.completedAt && !j.hasError && !j.processing).length,
    running: jobs.filter((j) => j.processing && !j.completedAt).length,
    failed: jobs.filter((j) => j.hasError).length,
    oldestQueued: (oldest?.createdAt ?? null) as string | null,
    sources: sources.map((s) => ({ repo: s.repo as string, polledAt: s.updatedAt as string })),
  }
}
