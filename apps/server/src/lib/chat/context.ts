import { workflowFor } from '../factory'
import type { Payload } from 'payload'
import { unansweredCriticalCount } from '../../app/(app)/lib/plan'
import { plainStatus } from '../../app/(app)/lib/epics'
import { loadOverviewRows, within, FORGE_TIMEOUT_MS } from '../../app/(app)/lib/overview'
import { ticketsOf, tenantsOf } from '../actions'
import { DEFAULT_MODEL_BY_TIER } from '../gateway'
import { board, gates, is, nameOf, title as stageTitle } from '../workflow'
import { loadInsights, RANGES } from '../../app/(app)/lib/insights'
import { nodeStats } from '../../app/(app)/lib/workflow-view'
import { ticketStatus } from '../../app/(app)/lib/status'
import { duration } from '../../app/(app)/lib/format'
import { graph } from '../workflow'
import { canDecide } from '../decision'

type Doc = Record<string, any>
export type PageContext = { label: string; markdown: string; entity?: { kind: 'ticket' | 'run' | 'request' | 'product'; id: number | string } }

export const CONTEXT_MAX_CHARS = 1500
const o = { depth: 0, overrideAccess: true } as const
const PAGES: Record<string, string> = {
  '/': 'Workflow', '/inbox': 'Inbox', '/insights': 'Insights', '/runs': 'Runs', '/requests': 'Requests', '/requests/new': 'New request', '/releases': 'Releases', '/release-notes': 'Release notes', '/knowledge': 'Knowledge', '/knowledge/edit': 'Knowledge editor', '/setup': 'Setup',
  '/settings': 'Settings', '/settings/api-key': 'Settings: API keys', '/settings/audit': 'Settings: Audit log', '/settings/bauherren': 'Settings: Members', '/settings/connections': 'Settings: Connections', '/settings/products': 'Settings: Products',
  '/settings/usage': 'Settings: Usage', '/settings/templates': 'Settings: Templates', '/workflow/edit': 'Workflow editor', '/settings/workspace': 'Settings: Workspace', '/settings/models': 'Settings: Models & budget', '/settings/profile': 'Settings: Profile', '/settings/knowledge': 'Settings: Knowledge repo', '/settings/health': 'Settings: Health',
}
/** One line of text others wrote: no line breaks or markup that could pose as page structure. */
const line = (s: unknown, n = 120): string => String(s ?? '').replace(/\s+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, n)
const day = (d: unknown): string => (d ? String(d).slice(0, 16).replace('T', ' ') : '-')
const gone = (): PageContext => ({ label: 'Not found', markdown: 'The page shows something that does not exist in this Workspace.' })
const make = (label: string, lines: string[], entity?: PageContext['entity']): PageContext => ({ label: line(label, 100), markdown: lines.join('\n').slice(0, CONTEXT_MAX_CHARS), ...(entity && { entity }) })
const numeric = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null)

/** The prepared Decision as plain lines, for the Ticket's page and the Inbox list. */
const decisionText = (d: Doc): string[] => [
  `Decision (${line(d.checkpoint)}): ${line(d.ask, 160)}`,
  ...(d.recommendation ? [`Recommendation: ${line(d.recommendation, 200)}`] : []),
  ...(d.why ?? []).slice(0, 3).map((w: string) => `- ${line(w, 140)}`),
  `Options: ${(d.options ?? []).map((o: Doc) => `${line(o.label, 40)} (${line(o.effect, 80)})`).join('; ')}`,
]

const inboxPage = async (payload: Payload, user: Doc, ws: number): Promise<PageContext> => {
  const { docs } = await payload.find({ collection: 'tickets', where: { workspace: { equals: ws }, state: { equals: 'open' }, needsYou: { exists: true } }, select: { number: true, title: true, needsYou: true, decision: true }, limit: 12, sort: 'updatedAt', ...o })
  const rows = (docs as Doc[]).filter((t) => canDecide(user, t.needsYou))
  return make('Inbox', ['Inbox: the decisions that wait for the person, each prepared the same way.', ...(rows.length ? rows.map((t) => `- #${t.number} ${line(t.title, 60)}: ${line(t.decision?.ask ?? t.needsYou, 140)}`) : ['Nothing needs the person.'])])
}

const decisionsOpen = async (payload: Payload, t: Doc): Promise<number | null> => {
  try {
    const ts = await ticketsOf(payload, typeof t.product === 'object' ? t.product.id : t.product)
    return unansweredCriticalCount(await within(ts.listComments(String(t.number)), FORGE_TIMEOUT_MS))
  } catch {
    return null
  }
}

const ticketPage = async (payload: Payload, user: Doc, ws: number, id: number): Promise<PageContext> => {
  const t = (await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: id } }, { workspace: { equals: ws } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  if (!t) return gone()
  const wf = workflowFor(ws)
  const row = (await loadOverviewRows(ws, true)).tickets.find((r) => r.id === id)
  const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: '-createdAt', limit: 4, select: { stage: true, status: true, mode: true, createdAt: true }, ...o })).docs as Doc[]
  const open = row?.needsYou === 'Approve plan' || row?.needsYou === 'Answer decisions' ? await decisionsOpen(payload, t) : null
  const admin = user.role === 'admin'
  return make(`Ticket #${t.number} ${line(t.title, 60)}`, [
    `Ticket #${t.number}: ${line(t.title)}`,
    `Stage: ${stageTitle(wf, t.state === 'closed' ? nameOf(wf, 'done') : (t.stage ?? nameOf(wf, 'triage')))}; status: ${row ? plainStatus(wf, row) : t.state === 'closed' ? 'Done' : 'Open'}`,
    `Needs the person: ${row?.needsYou ?? 'nothing'}${open != null ? `; open decisions: ${open}` : ''}`,
    ...(t.decision && t.decision.need === t.needsYou ? decisionText(t.decision) : []),
    ...(row?.blockedBy.length ? [`Blocked by: ${row.blockedBy.map((b) => `#${b.number}`).join(', ')}`] : []),
    ...(row?.waiting ? [`Waiting: ${line(row.waiting)}`] : []),
    ...(runs.length ? ['Latest Runs (id, stage, status, when):', ...runs.map((r) => `- Run ${r.id}: ${stageTitle(wf, r.stage)}, ${r.status}, ${day(r.createdAt)}${admin ? `, ${r.mode}` : ''}`)] : ['No Runs yet']),
  ], { kind: 'ticket', id })
}

const runPage = async (payload: Payload, user: Doc, ws: number, id: number): Promise<PageContext> => {
  const r = (await payload.find({ collection: 'runs', where: { and: [{ id: { equals: id } }, { workspace: { equals: ws } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  const t = r && ((await payload.find({ collection: 'tickets', where: { and: [{ id: { equals: r.ticket } }, { workspace: { equals: ws } }] }, limit: 1, ...o })).docs[0] as Doc | undefined)
  if (!r || !t) return gone()
  return make(`Run ${r.id} of #${t.number}`, [
    `Run ${r.id} for Ticket #${t.number}: ${line(t.title)}`,
    `Stage: ${stageTitle(workflowFor(ws), r.stage)}; status: ${r.status}`,
    `Started: ${day(r.startedAt)}; finished: ${day(r.finishedAt)}`,
    ...(user.role === 'admin' ? [`Mode: ${r.mode}; cost: ${r.costUsd ?? '-'} USD`] : []),
    ...(r.error ? [`Error: ${line(r.error, 300)}`] : []),
  ], { kind: 'run', id })
}

const requestPage = async (payload: Payload, ws: number, id: number): Promise<PageContext> => {
  const s = (await payload.find({ collection: 'intake_sessions', where: { and: [{ id: { equals: id } }, { 'product.workspace': { equals: ws } }] }, limit: 1, depth: 1, overrideAccess: true })).docs[0] as Doc | undefined
  if (!s) return gone()
  return make(`Request ${s.id}`, [`Request ${s.id} (${s.status}) for Product ${line(s.product?.name)}`, `Problem: ${line(s.draft?.problem, 300) || 'not stated yet'}`, ...(s.ticketNumber != null ? [`Became Ticket #${s.ticketNumber}`] : [])], { kind: 'request', id })
}

const productPage = async (payload: Payload, ws: number, id: number): Promise<PageContext> => {
  const p = (await payload.find({ collection: 'products', where: { and: [{ id: { equals: id } }, { workspace: { equals: ws } }] }, limit: 1, ...o })).docs[0] as Doc | undefined
  if (!p) return gone()
  return make(`Product ${line(p.name, 60)}`, [`Product ${line(p.name)} (${line(p.slug)})`, `Staging: ${line(p.stagingUrl) || 'none'}; deploy: ${p.deployMode}; merge: ${p.mergeMode}; auto-merge: ${p.autoMerge ? 'on' : 'off'}`], { kind: 'product', id })
}

const settingsPage = async (payload: Payload, ws: number, page: string, name: string): Promise<PageContext> => {
  const w = (await payload.findByID({ collection: 'workspaces', id: ws, ...o })) as Doc
  const wf = workflowFor(ws)
  if (page === 'workflow') {
    const g = gates(wf)
    return make(name, [`${name}: the workflow stages, WIP limits and human gates.`, `Stages: ${wf.stages.map((s) => `${s.title}${w.wipLimits?.[s.name] ? ` (WIP ${w.wipLimits[s.name]})` : ''}`).join(' > ')}`, `Human gates: ${[g.plan && 'plan', g.staging && 'staging', g.production && 'production'].filter(Boolean).join(', ') || 'none'}`, `Expedite lane: ${w.expediteLane === false ? 'off' : 'on'}`])
  }
  if (page === 'models') {
    const modes = { ...(w.defaultMode && { default: w.defaultMode }), ...w.modeByStage }
    return make(name, [`${name}: run mode and model tiers of Workspace ${line(w.name)}.`, `Run mode: ${Object.entries(modes).map(([k, v]) => `${k}=${v}`).join(', ') || 'factory default'}`, `Model tiers: ${Object.entries({ ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }).map(([k, v]) => `${k}=${v}`).join(', ')}`])
  }
  return make(name, [`${name} page.`])
}

const query = (path: string) => new URLSearchParams(path.split('#')[0]!.split('?')[1] ?? '')

/** The Workflow view: the selected `?stage=` and, per stage, the open Tickets with their status (stage and status counts only; the Tickets are in `list_tickets`). */
const workflowPage = async (ws: number, path: string): Promise<PageContext> => {
  const wf = workflowFor(ws)
  const { tickets, wip } = await loadOverviewRows(ws, false)
  const open = tickets.filter((t) => t.open && !is(wf, t.stage, 'container'))
  const stats = nodeStats(wf, open, wip, {})
  const nodes = graph(wf).nodes
  const picked = nodes.find((n) => n.id === query(path).get('stage'))
  const lines = board(wf).map((stage) => {
    const n = stats.stages.get(stage)!
    const rows = open.filter((t) => t.stage === stage)
    const by = new Map<string, number>()
    for (const t of rows) by.set(ticketStatus(wf, t).label, (by.get(ticketStatus(wf, t).label) ?? 0) + 1)
    return `- ${stageTitle(wf, stage)}: ${rows.length}${n.limit ? `/${n.limit}` : ''}${by.size ? ` (${[...by].map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')})` : ''}`
  })
  const waiting = [...stats.checkpoints].map(([id, c]) => `${nodes.find((x) => x.id === id)?.title ?? id}: ${c}`)
  return make('Workflow', [
    'Workflow: the stages of the factory with their open Tickets and statuses.',
    ...(picked ? [`Selected: ${picked.title}${picked.id.includes(':') ? ' (a human checkpoint; the list shows the Tickets waiting there)' : ''}`] : []),
    ...lines,
    `Waiting at checkpoints: ${waiting.length ? waiting.join(', ') : 'nothing'}`,
    `Need the person: ${open.filter((t) => t.needsYou).slice(0, 8).map((t) => `#${t.number} (${t.needsYou})`).join(', ') || 'nothing'}`,
  ])
}

/** Insights: the range, the tiles and the bottleneck sentence as text. */
const insightsPage = async (payload: Payload, ws: number, path: string): Promise<PageContext> => {
  const wf = workflowFor(ws)
  const q = query(path)
  const days = RANGES.find((r) => String(r) === q.get('range')) ?? 30
  const d = await loadInsights(payload, wf, ws, { days, product: numeric(q.get('product') ?? '') })
  const t = (s: number | null) => (s == null ? '-' : duration(s))
  return make('Insights', [
    `Insights: time to market of the Tickets that started in the last ${days} days.`,
    `Done: ${d.done}; lead time median ${t(d.leadMedianSec)}, 85th percentile ${t(d.leadP85Sec)}; cycle time median ${t(d.cycleMedianSec)}`,
    `Share of time: ${Object.entries(d.share).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ')}`,
    d.bottleneck ? `Bottleneck: ${d.bottleneck.sentence}` : 'Bottleneck: none yet',
  ])
}

/** What the person is looking at, from the PATH only (never client-sent content), limited to the Workspace they act in; a foreign or unknown id reads as "not found". */
export const resolveContext = async (payload: Payload, user: Doc, workspace: number | string, a: { path: string }): Promise<PageContext> => {
  const ws = Number(workspace)
  if (user.role !== 'admin' && !tenantsOf(user).map(Number).includes(ws)) return gone()
  const path = (a.path.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  const [, section, id, ...more] = path.split('/')
  const n = numeric(id ?? '')
  if (!more.length && n !== null) {
    if (section === 'tickets') return ticketPage(payload, user, ws, n)
    if (section === 'runs') return runPage(payload, user, ws, n)
    if (section === 'requests') return requestPage(payload, ws, n)
  }
  if (section === 'settings' && id === 'products' && more.length === 1 && numeric(more[0]!) !== null) return productPage(payload, ws, numeric(more[0]!)!)
  if (section === 'settings' && id && !more.length && PAGES[path]) return settingsPage(payload, ws, id, PAGES[path])
  if (path === '/workflow/edit') return settingsPage(payload, ws, 'workflow', PAGES[path])
  if (path === '/inbox') return inboxPage(payload, user, ws)
  if (path === '/') return workflowPage(ws, a.path)
  if (path === '/insights') return insightsPage(payload, ws, a.path)
  return make(PAGES[path] ?? 'Unknown page', [PAGES[path] ? `${PAGES[path]} page.` : `A page the assistant has no details for (${line(path, 80)}).`])
}
