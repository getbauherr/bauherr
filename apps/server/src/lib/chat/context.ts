import type { Payload } from 'payload'
import { unansweredCriticalCount } from '../../app/(app)/lib/plan'
import { plainStatus } from '../../app/(app)/lib/epics'
import { loadOverviewRows, within, FORGE_TIMEOUT_MS } from '../../app/(app)/lib/overview'
import { ticketsOf, tenantsOf } from '../actions'
import { DEFAULT_MODEL_BY_TIER } from '../gateway'
import { DEFAULT, gates, nameOf, title as stageTitle } from '../workflow'
import { factoryStatus } from './tools'

type Doc = Record<string, any>
export type PageContext = { label: string; markdown: string; entity?: { kind: 'ticket' | 'run' | 'request' | 'product'; id: number | string } }

export const CONTEXT_MAX_CHARS = 1500
const o = { depth: 0, overrideAccess: true } as const
const PAGES: Record<string, string> = {
  '/': 'Board', '/runs': 'Runs', '/requests': 'Requests', '/requests/new': 'New request', '/releases': 'Releases', '/release-notes': 'Release notes', '/knowledge': 'Knowledge', '/knowledge/edit': 'Knowledge editor', '/setup': 'Setup',
  '/settings': 'Settings', '/settings/api-key': 'Settings: API key', '/settings/audit': 'Settings: Audit log', '/settings/bauherren': 'Settings: Members', '/settings/connections': 'Settings: Connections', '/settings/products': 'Settings: Products',
  '/settings/usage': 'Settings: Usage', '/settings/workflow': 'Settings: Board & WIP', '/settings/workspace': 'Settings: Workspace',
}
/** One line of text others wrote: no line breaks or markup that could pose as page structure. */
const line = (s: unknown, n = 120): string => String(s ?? '').replace(/\s+/g, ' ').replace(/[<>`]/g, '').trim().slice(0, n)
const day = (d: unknown): string => (d ? String(d).slice(0, 16).replace('T', ' ') : '-')
const gone = (): PageContext => ({ label: 'Not found', markdown: 'The page shows something that does not exist in this Workspace.' })
const make = (label: string, lines: string[], entity?: PageContext['entity']): PageContext => ({ label: line(label, 100), markdown: lines.join('\n').slice(0, CONTEXT_MAX_CHARS), ...(entity && { entity }) })
const numeric = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null)

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
  const wf = DEFAULT()
  const row = (await loadOverviewRows(ws, true)).tickets.find((r) => r.id === id)
  const runs = (await payload.find({ collection: 'runs', where: { ticket: { equals: id } }, sort: '-createdAt', limit: 4, select: { stage: true, status: true, mode: true, createdAt: true }, ...o })).docs as Doc[]
  const open = row?.needsYou === 'Approve plan' || row?.needsYou === 'Answer decisions' ? await decisionsOpen(payload, t) : null
  const admin = user.role === 'admin'
  return make(`Ticket #${t.number} ${line(t.title, 60)}`, [
    `Ticket #${t.number}: ${line(t.title)}`,
    `Stage: ${stageTitle(wf, t.state === 'closed' ? nameOf(wf, 'done') : (t.stage ?? nameOf(wf, 'triage')))}; status: ${row ? plainStatus(row) : t.state === 'closed' ? 'Done' : 'Open'}`,
    `Needs the person: ${row?.needsYou ?? 'nothing'}${open != null ? `; open decisions: ${open}` : ''}`,
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
    `Stage: ${stageTitle(DEFAULT(), r.stage)}; status: ${r.status}`,
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
  const wf = DEFAULT()
  if (page === 'workflow') {
    const g = gates(wf)
    return make(name, [`${name}: the workflow stages, WIP limits and human gates.`, `Stages: ${wf.stages.map((s) => `${s.title}${w.wipLimits?.[s.name] ? ` (WIP ${w.wipLimits[s.name]})` : ''}`).join(' > ')}`, `Human gates: ${[g.plan && 'plan', g.staging && 'staging', g.production && 'production'].filter(Boolean).join(', ') || 'none'}`, `Expedite lane: ${w.expediteLane === false ? 'off' : 'on'}`])
  }
  if (page === 'workspace') {
    const modes = { ...(w.defaultMode && { default: w.defaultMode }), ...w.modeByStage }
    return make(name, [`${name}: run mode and model tiers of Workspace ${line(w.name)}.`, `Run mode: ${Object.entries(modes).map(([k, v]) => `${k}=${v}`).join(', ') || 'factory default'}`, `Model tiers: ${Object.entries({ ...DEFAULT_MODEL_BY_TIER, ...w.modelByTier }).map(([k, v]) => `${k}=${v}`).join(', ')}`])
  }
  return make(name, [`${name} page.`])
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
  if (path === '/') {
    const s = await factoryStatus(ws)
    return make('Board', ['Board: all open Tickets by stage.', ...s.stages.map((x) => `- ${x.stage}: ${x.tickets}${x.wipLimit ? `/${x.wipLimit}` : ''}`), `Need the person: ${s.needYou.length ? s.needYou.slice(0, 8).map((t) => `#${t.number} (${t.need})`).join(', ') : 'nothing'}`])
  }
  return make(PAGES[path] ?? 'Unknown page', [PAGES[path] ? `${PAGES[path]} page.` : `A page the assistant has no details for (${line(path, 80)}).`])
}
