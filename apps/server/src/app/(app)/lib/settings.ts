import type { Check, Forge } from '@bauherr/adapters'
import { formatReviewChecks } from '@bauherr/runner'
import { ValidationError } from 'payload'
import { type Cause, FINDING_FRESH_MS } from '../../../lib/liveness'
import { budgetStatus, DEFAULT_MODEL_BY_TIER, gatewayEnabled } from '../../../lib/gateway'
import { gateOn, humanGates, packed, productionGateOn, resolveMode } from '../../../lib/mode'
import { PRESETS, presetOf } from '../../../lib/providers'
import { blockedBy } from '../../../lib/settings-guards'
import { wipLimit } from '../../../lib/wip-limits'
import { wipStages } from '../../../lib/workflow'
import { activeVersion, defaultHash, exportFactory, workflowFor } from '../../../lib/factory'
import { backendFor } from '../../../lib/adapters'
import { connectionInput } from '../../../lib/connection'
import { forgeOf } from '../../../lib/release'
import { wipCount } from '../../../lib/wip'
import { setupOf } from './product-setup'
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
      const n = Object.keys(fields).length
      return { fields, error: n ? (n === 1 ? '1 field needs attention' : `${n} fields need attention`) : (e as Error).message }
    }
    return { error: (e as Error).message }
  }
}

/** Provider presets as the Connection form needs them. */
export const connectionPresets = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { required: v.required, hint: v.secret.hint }]))

export const isAdmin = (u: Bauherr) => u.role === 'admin'
export const only = (u: Bauherr) => {
  if (!isAdmin(u)) throw new Error('Only an Admin can change this.')
}

const o = { overrideAccess: true, depth: 0 } as const

/** Preset (of the first llm-provider Connection; anthropic when it has none) plus the slugs of all of them. */
export async function presetFor(workspace: number) {
  const { docs } = await (await payloadClient()).find({ collection: 'connections', where: { workspace: { equals: workspace }, kind: { equals: 'llm-provider' } }, sort: 'id', pagination: false, select: { config: true, slug: true }, ...o } as never)
  const conns = docs as unknown as { config?: never; slug: string }[]
  return { ...PRESETS[presetOf(conns[0]?.config)], slugs: conns.map((c) => c.slug) }
}

export async function loadWorkspaceSettings(id: number) {
  const payload = await payloadClient()
  const ws = (await payload.findByID({ collection: 'workspaces', id, select: { gatewayKey: false }, ...o } as never)) as unknown as Record<string, any>
  const preset = await presetFor(id)
  const github = (await payload.find({ collection: 'connections', where: { and: [{ workspace: { equals: id } }, { kind: { equals: 'github' } }] }, select: { name: true }, pagination: false, ...o } as never)).docs as unknown as { id: number; name: string }[]
  const spend = gatewayEnabled() && process.env.GATEWAY_DATABASE_URL ? await budgetStatus(ws.slug).catch(() => null) : null
  return {
    name: ws.name as string,
    slug: ws.slug as string,
    budgetUnit: (ws.budgetUnit ?? 'usd') as 'usd' | 'tokens',
    budgetUsd30d: ws.budgetUsd30d as number | null,
    budgetTokens30d: ws.budgetTokens30d as number | null,
    hasRouter: !!ws.routerKey,
    routerBudgetShare: (ws.routerBudgetShare ?? 20) as number,
    // Tiers are stored as `<connection>/<model>`; the form shows the bare id of the first Connection, which `saveWorkspace` qualifies again.
    modelByTier: Object.fromEntries(Object.entries((ws.modelByTier ?? {}) as Record<string, string>).map(([t, v]) => [t, preset.slugs[0] && v.startsWith(`${preset.slugs[0]}/`) ? v.slice(preset.slugs[0].length + 1) : v])),
    modelChoices: preset.defaultModels ? [...new Set(Object.values(preset.defaultModels))] : null,
    defaultMode: (ws.defaultMode ?? '') as string,
    modeByStage: (ws.modeByStage ?? {}) as Record<string, string>,
    placeholders: preset.defaultModels ?? DEFAULT_MODEL_BY_TIER,
    tiersRequired: !preset.defaultModels,
    githubConnections: github.map((c) => [String(c.id), c.name] as [string, string]),
    knowledgeConnection: String(typeof ws.knowledgeConnection === 'object' ? ws.knowledgeConnection?.id ?? '' : ws.knowledgeConnection ?? ''),
    knowledgeRepo: (ws.knowledgeRepo ?? '') as string,
    spend,
    gatewayOn: gatewayEnabled(),
  }
}

export async function loadProducts(workspace: number) {
  const payload = await payloadClient()
  const where = { workspace: { equals: workspace } }
  const find = async (collection: string, extra: object = {}) => (await payload.find({ collection, where, sort: 'id', ...o, pagination: false, ...extra } as never)).docs as unknown as Record<string, any>[]
  const [products, repositories, sources, connections, embedTokens] = await Promise.all([find('products'), find('repositories'), find('ticket_sources', { depth: 1 }), find('connections', { select: { secret: false } }), find('embed_tokens')])
  return {
    connections: connections.filter((c) => c.kind === 'github' || c.kind === 'gitlab').map((c) => ({ id: c.id as number, name: c.name as string })),
    products: await Promise.all(
      products.map(async (p) => {
        const product = {
          id: p.id as number,
          // Heuristic for setup step 3: any later Product save (not only the staging/gates form) also counts; create alone can differ by a few ms.
          touched: Date.parse(p.updatedAt) - Date.parse(p.createdAt) >= 1000,
          name: p.name as string,
          slug: p.slug as string,
          deploy: { stagingUrl: (p.stagingUrl ?? '') as string, mode: (p.deployMode ?? 'observe-ci') as string, webhookUrl: (p.deployWebhookUrl ?? '') as string, checks: (p.deployChecks ?? '') as string, autoMerge: p.autoMerge !== false, expediteSkipStaging: !!p.expediteSkipStaging, checkRetries: (p.checkRetries ?? 1) as number, gateOwners: (p.gateOwners ?? '') as string, productionGate: !!p.productionGate, productionWebhookUrl: (p.productionWebhookUrl ?? '') as string, productionChecks: (p.productionChecks ?? '') as string, releaseMode: (p.releaseMode ?? 'notes-only') as string, releaseReminderDays: (p.releaseReminderDays ?? 7) as number },
          merge: { mode: (p.mergeMode ?? 'direct') as string, preflight: (p.mergePreflight ?? null) as { ok: boolean; problems: string[]; at: string } | null },
          reviewChecks: formatReviewChecks(p.reviewChecks),
          securityScan: { enabled: !!p.securityScan?.enabled, cron: (p.securityScan?.cron ?? '0 0 4 * * 1') as string, maxBudgetUsd: (p.securityScan?.maxBudgetUsd ?? '') as number | '', maxTurns: (p.securityScan?.maxTurns ?? '') as number | '', lastScanAt: (p.securityScan?.lastScanAt ?? null) as string | null },
          blocked: await blockedBy(payload, 'products', p.id),
          embedTokens: embedTokens
            .filter((e) => (e.product?.id ?? e.product) === p.id)
            .map((e) => ({ id: e.id as number, name: e.name as string, origins: ((e.allowedOrigins ?? []) as string[]).join(', '), createdAt: e.createdAt as string, revokedAt: (e.revokedAt ?? '') as string })),
          repositories: repositories.filter((r) => r.product === p.id).map((r) => ({ id: r.id as number, fullName: r.fullName as string })),
          sources: sources
            .filter((s) => (s.product?.id ?? s.product) === p.id)
            .map((s) => ({ id: s.id as number, repo: s.repo as string, connection: (s.connection?.name ?? '') as string, cursor: (s.cursor ?? '') as string, polledAt: s.updatedAt as string })),
        }
        const productionOn = productionGateOn(workflowFor(workspace), { productionGate: product.deploy.productionGate })
        return { ...product, productionOn, setup: setupOf(product, productionOn) }
      }),
    ),
  }
}

/** One Product of the Workspace with the workflow facts and the people who can be gate owners (Members with a GitHub login); undefined when it belongs to another Workspace. */
export async function loadProduct(workspace: number, id: number, viewerIsAdmin = false) {
  const { products, connections } = await loadProducts(workspace)
  const wf = workflowFor(workspace)
  const product = products.find((p) => p.id === id)
  if (!product) return undefined
  const { docs } = await (await payloadClient()).find({ collection: 'bauherren', where: { and: [{ githubLogin: { exists: true } }, { or: [{ role: { equals: 'admin' } }, { 'tenants.tenant': { equals: workspace } }] }] }, sort: 'email', pagination: false, ...o } as never)
  const all = (docs as unknown as Record<string, any>[]).filter((b) => b.githubLogin).map((b) => ({ email: b.email as string, login: b.githubLogin as string, admin: b.role === 'admin' }))
  // Admins are not tenant-scoped: only an Admin sees other Admins' emails; for everyone the callout still knows whether an Admin can be notified.
  const members = viewerIsAdmin ? all : all.filter((m) => !m.admin)
  return { product, connections, members, adminApprover: all.some((m) => m.admin), workflow: { forcesProduction: productionGateOn(wf), plan: gateOn(wf, 'plan'), staging: gateOn(wf, 'release') } }
}

export type RecentCheck = { name: string; seen: number; of: number; lastConclusion: string }

const RECENT_COMMITS = 5
const MAX_COMMITS_READ = 10

/**
 * Check names reported on the newest commits of the default branch plus `extraShas` (merge commits of recent Tickets), at most 10 commits in all.
 * Sorted by how often a name was seen, then by name. `null` when the forge could not be read within `timeoutMs`.
 */
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

/** The check names the Product's forge reported lately, for the check pickers; `null` when there is no forge or it does not answer. Read-only, call it on the Product page only. */
export async function recentChecks(productId: number): Promise<RecentCheck[] | null> {
  try {
    const payload = await payloadClient()
    const { backend, repo } = await forgeOf(payload, productId)
    const merged = await payload.find({ collection: 'tickets', where: { and: [{ product: { equals: productId } }, { mergeSha: { exists: true } }] }, sort: '-id', limit: RECENT_COMMITS, select: { mergeSha: true }, ...o } as never)
    return await collectChecks(backend.forge, repo, (merged.docs as unknown as { mergeSha?: string }[]).flatMap((t) => t.mergeSha || []))
  } catch {
    return null
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
  const { docs } = await (await payloadClient()).find({ collection: 'bauherren', where, sort: 'email', ...o, depth: 1, pagination: false, showHiddenFields: true } as never)
  return (docs as unknown as Record<string, any>[]).map((b) => ({
    id: b.id as number,
    email: b.email as string,
    role: b.role as string,
    workspaces: ((b.tenants ?? []) as { tenant: { id: number; name: string } | number }[])
      .flatMap((t) => (typeof t.tenant === 'object' && t.tenant ? [t.tenant] : []))
      .filter((w) => admin || own.includes(w.id)),
    locked: !!b.lockUntil && new Date(b.lockUntil as string).getTime() > Date.now(),
    githubLogin: (b.githubLogin ?? '') as string,
    oidcLinked: !!b.oidcSubject,
    oidcSubject: admin ? ((b.oidcSubject ?? '') as string) : '',
  }))
}

type Doc = Record<string, any>
const ref = (v: any) => (v && typeof v === 'object' ? (v as Doc) : null)

const TICKET_FILTER = /^(?:([^#\s]+)?#)?(\d+)$/

/** Newest 200 rows of the Workspace's audit trail. `ticket` is `#n` or `repo#n` (repo = full name or Product slug), `run` a Run id; `actor` applies to human touches only. A malformed `ticket` or `run` yields `errors` and no rows. */
export async function loadAudit(workspace: number, tab: 'touches' | 'calls', f: { ticket?: string; run?: string; actor?: string }) {
  const payload = await payloadClient()
  const where: Doc = { workspace: { equals: workspace } }
  const errors: { ticket?: string; run?: string } = {}
  const run = f.run?.trim()
  if (run) /^\d+$/.test(run) ? (where.run = { equals: Number(run) }) : (errors.run = 'Enter a Run id, for example 12.')
  const ticket = f.ticket?.trim()
  const m = ticket ? TICKET_FILTER.exec(ticket) : null
  const prefix = tab === 'touches' ? 'ticket' : 'run.ticket'
  if (ticket && !m) errors.ticket = 'Enter #12 or repo#12.'
  else if (m) {
    where[`${prefix}.number`] = { equals: Number(m[2]) }
    if (m[1]) {
      const [repos, products] = await Promise.all([
        payload.find({ collection: 'repositories', where: { workspace: { equals: workspace }, fullName: { equals: m[1] } }, pagination: false, ...o } as never),
        payload.find({ collection: 'products', where: { workspace: { equals: workspace }, slug: { equals: m[1] } }, pagination: false, ...o } as never),
      ])
      const ids = [...(repos.docs as unknown as Doc[]).map((r) => r.product), ...products.docs.map((p) => p.id)]
      if (!ids.length) return { rows: [], errors }
      where[`${prefix}.product`] = { in: ids }
    }
  }
  if (Object.keys(errors).length) return { rows: [], errors }
  if (tab === 'touches' && f.actor) where.actor = { like: f.actor.replace(/[\\%_]/g, '\\$&') }
  const [{ docs }, repositories] = await Promise.all([
    payload.find({ collection: tab === 'touches' ? 'human_touches' : 'tool_calls', where, sort: '-createdAt', limit: 200, depth: 2, pagination: false, overrideAccess: true } as never),
    payload.find({ collection: 'repositories', where: { workspace: { equals: workspace } }, sort: 'id', pagination: false, select: { fullName: true, product: true }, ...o } as never),
  ])
  const repoOf = new Map<unknown, string>()
  for (const r of repositories.docs as unknown as Doc[]) if (!repoOf.has(ref(r.product)?.id ?? r.product)) repoOf.set(ref(r.product)?.id ?? r.product, r.fullName)
  const rows = (docs as unknown as Doc[]).map((d) => {
    const run = ref(d.run)
    const t = ref(tab === 'touches' ? d.ticket : run?.ticket)
    const product = ref(t?.product)
    return {
      id: d.id as number,
      at: (d.at ?? d.createdAt) as string,
      kind: (d.kind ?? d.name) as string,
      actor: (d.actor ?? '') as string,
      status: (d.status ?? '') as string,
      durationMs: d.durationMs as number | null,
      digest: (d.inputDigest ?? '') as string,
      runId: (run?.id ?? d.run ?? null) as number | null,
      ticket: t ? { id: t.id as number, label: `${repoOf.get(product?.id ?? t.product) ?? product?.slug ?? 'ticket'}#${t.number}` } : null,
    }
  })
  return { rows, errors }
}

/** The Workspace's workflow with the mode each stage resolves to, its WIP columns and the active factory file version. */
export async function loadWorkflow(workspace: number) {
  const payload = await payloadClient()
  const wf = workflowFor(workspace)
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, select: { defaultMode: true, modeByStage: true, wipLimits: true, expediteLane: true }, ...o } as never)) as Doc
  const stages = packed(wf).map((s) => ({ name: s.name, mode: resolveMode(wf, ws, s.name), gate: [s.gate && `gate: ${s.gate}`].filter(Boolean).join(', '), steps: (s.steps ?? []).map((x) => (x.skill ? `${x.kind}: ${x.skill}` : x.kind)) }))
  const products = await payload.find({ collection: 'products', where: { workspace: { equals: workspace } }, sort: 'name', pagination: false, ...o } as never)
  const wip = await Promise.all(wipStages(wf).map(async (s) => ({ stage: s, limit: wipLimit(ws, s, wf), count: await wipCount(payload, workspace, s) })))
  const overlap = (products.docs as unknown as Doc[]).map((p) => {
    const ignore = (p.overlapIgnore ?? []) as string[]
    const stored = p.overlapSuggestions as { at: string; items: { path: string; percent: number }[] } | null
    return { id: p.id as number, name: p.name as string, ignore, suggestions: (stored?.items ?? []).filter((x) => !ignore.includes(x.path)), suggestedAt: stored?.at ?? null }
  })
  const active = await activeVersion(payload, workspace)
  return {
    stages,
    wip,
    expediteLane: ws.expediteLane !== false,
    overlap,
    gates: humanGates(wf),
    ladder: { plan: gateOn(wf, 'plan'), staging: gateOn(wf, 'release'), production: productionGateOn(wf) },
    factory: { active, custom: !!active && active.hash !== defaultHash(), source: await exportFactory(payload, workspace), stageCount: wf.stages.length, roleCount: wf.roles.length },
  }
}

/** Factory health: instance-wide job counts of the last 24 h, the oldest queued job (within 7 days), last poll and error per Ticket source of the Workspace, and the top 5 flaky checks (passed after a retry) of the last 30 days. */
/** `dead` is read from the findings the `watch-liveness` sweep stores on the Tickets (no forge call); null ("could not be checked") when a finding is older than 15 minutes, never an empty list from a sweep that stopped. */
export async function loadHealth(workspace: number) {
  const payload = await payloadClient()
  const day = { greater_than_equal: new Date(Date.now() - 864e5).toISOString() }
  const count = async (where: Doc) => (await payload.count({ collection: 'payload-jobs', where: { createdAt: day, ...where }, ...o } as never)).totalDocs
  const [queued, running, failed, oldest, sources, findings] = await Promise.all([
    count({ completedAt: { exists: false }, processing: { not_equals: true }, hasError: { not_equals: true } }),
    count({ processing: { equals: true }, completedAt: { exists: false } }),
    count({ hasError: { equals: true } }),
    payload.find({ collection: 'payload-jobs', where: { createdAt: { greater_than_equal: new Date(Date.now() - 7 * 864e5).toISOString() }, completedAt: { exists: false }, processing: { not_equals: true }, hasError: { not_equals: true } }, sort: 'createdAt', limit: 1, pagination: false, select: { createdAt: true }, ...o } as never),
    payload.find({ collection: 'ticket_sources', where: { workspace: { equals: workspace } }, sort: 'id', pagination: false, select: { repo: true, lastPolledAt: true, lastError: true }, ...o } as never),
    payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { state: { equals: 'open' } }, { liveness: { exists: true } }] }, sort: 'number', pagination: false, select: { number: true, liveness: true }, ...o } as never),
  ])
  const found = findings.docs as unknown as { id: number; number: number; liveness: { cause: string; need: string | null; at: string } }[]
  const stale = found.some((t) => Date.now() - Date.parse(t.liveness.at) > FINDING_FRESH_MS)
  const flakeRows = (await payload.find({ collection: 'check_flakes', where: { workspace: { equals: workspace }, outcome: { equals: 'flake' }, createdAt: { greater_than_equal: new Date(Date.now() - 30 * 864e5).toISOString() } }, sort: '-createdAt', pagination: false, ...o, depth: 1 } as never)).docs as unknown as Doc[]
  const byCheck = new Map<string, { check: string; count: number; lastSeen: string; ticket: number | null }>()
  for (const r of flakeRows) {
    const f = byCheck.get(r.checkName) ?? { check: r.checkName as string, count: 0, lastSeen: r.createdAt as string, ticket: (r.ticket?.number ?? null) as number | null }
    byCheck.set(r.checkName, { ...f, count: f.count + 1 })
  }
  const flakes = [...byCheck.values()]
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 5)
  const hotfixes = (await payload.find({ collection: 'tickets', where: { and: [{ workspace: { equals: workspace } }, { expedite: { equals: true } }, { expediteAt: { exists: true } }, { releaseAt: { exists: true } }] }, sort: '-releaseAt', limit: 5, pagination: false, select: { expediteAt: true, releaseAt: true }, ...o } as never)).docs as unknown as Doc[]
  const leadMs = hotfixes.map((h) => new Date(h.releaseAt).getTime() - new Date(h.expediteAt).getTime()).filter((ms) => ms >= 0)
  return {
    /** Mean time from the Expedite flag to the merge of the last 5 Hotfixes; null when there is none. */
    expediteLeadMs: leadMs.length ? Math.round(leadMs.reduce((a, b) => a + b, 0) / leadMs.length) : null,
    queued,
    running,
    failed,
    oldestQueued: ((oldest.docs[0] as Doc | undefined)?.createdAt ?? null) as string | null,
    /** Tickets with no live Run, no wait and no need for the owner; the goal is 0. */
    dead: stale ? null : found.filter((t) => !t.liveness.need).map((t) => ({ id: t.id, number: t.number, cause: t.liveness.cause as Cause })),
    sources: (sources.docs as unknown as Doc[]).map((s) => ({ repo: s.repo as string, polledAt: (s.lastPolledAt ?? null) as string | null, error: (s.lastError ?? null) as string | null })),
    flakes,
  }
}

const REPO_LIST_MS = 3000

/** Full names of the repositories a forge Connection can see, sorted; null when the forge fails or does not answer within 3 s (the form then asks for a typed `owner/name`). One attempt, no retries. */
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
