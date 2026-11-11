import type { Payload } from 'payload'
import type { Need } from '../../../lib/needs-you'
import { NEED_NODE } from '../../../lib/checkpoints'
import { flow } from '../../../lib/history'
import { byKind, type Kind, type Workflow } from '../../../lib/workflow'
import type { Mode } from '../../../lib/mode'
import type { TeamRole } from '../../../lib/sessions'
import type { TicketRow } from './overview'
import { ticketStatus } from './status'

export type Exec = { label: string; session: boolean; tip: string }
export type Bar = { working: number; human: number; ci: number; queued: number }
export type NodeStats = { count: number; limit: number | null; bar: Bar; execs: Exec[]; medianSec: number | null; state: 'active' | 'attention' | 'idle' }

const CHECKPOINTS = NEED_NODE

/** The graph node id (`<stage>:refine|gate|production`) of the human checkpoint a Ticket waits at, else null. */
export const checkpointOf = (wf: Workflow, t: Pick<TicketRow, 'needsYou' | 'stage'>): string | null => {
  if (t.needsYou === 'Decision needed') return t.stage
  const c = t.needsYou ? CHECKPOINTS[t.needsYou as Need] : undefined
  const stage = c && byKind(wf, c[0])?.name
  return stage ? `${stage}:${c![1]}` : null
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

/** Median seconds a Ticket spent in each stage (all phases but closed), over the Tickets that started in the last `days` days. */
export const stageMedians = async (payload: Payload, workspace: number, product: number | null, days = 30): Promise<Record<string, number>> => {
  const f = await flow(payload, workspace, { from: new Date(Date.now() - days * 864e5).toISOString(), to: new Date(Date.now() + 6e4).toISOString(), ...(product && { product }) })
  const per = new Map<string, number[]>()
  for (const t of f.tickets) {
    const sums = new Map<string, number>()
    for (const s of t.stages) if (s.phase !== 'closed') sums.set(s.stage, (sums.get(s.stage) ?? 0) + s.seconds)
    for (const [stage, sec] of sums) per.set(stage, [...(per.get(stage) ?? []), sec])
  }
  return Object.fromEntries([...per].map(([stage, xs]) => [stage, median(xs)!]))
}

/** Per stage: tickets, WIP limit, the four-phase bar, who works there right now, median time in stage and a state for the top border; and per checkpoint the Tickets waiting at it. */
export const nodeStats = (wf: Workflow, rows: TicketRow[], wip: Record<string, { count: number; limit: number | null }>, medians: Record<string, number>, now = Date.now()) => {
  const stages = new Map<string, NodeStats>()
  const checkpoints = new Map<string, number>()
  const of = (stage: string): NodeStats => {
    if (!stages.has(stage)) stages.set(stage, { count: 0, limit: wip[stage]?.limit ?? null, bar: { working: 0, human: 0, ci: 0, queued: 0 }, execs: [], medianSec: medians[stage] ?? null, state: 'idle' })
    return stages.get(stage)!
  }
  for (const s of wf.stages) of(s.name)
  for (const t of rows) {
    if (!t.open) continue
    const n = of(t.stage)
    const s = ticketStatus(wf, t, now)
    n.count++
    if (s.phase !== 'done') n.bar[s.phase === 'working' ? 'working' : s.phase === 'human' ? 'human' : s.phase === 'ci' ? 'ci' : 'queued']++
    if (s.phase === 'working' && t.run) n.execs.push({ label: t.run.mode === 'session' || t.run.executor === 'session' ? t.run.sessionLabel || t.owner || 'Session' : 'Runner', session: t.run.mode === 'session' || t.run.executor === 'session', tip: `${s.who} · #${t.number} ${s.detail}` })
    const c = checkpointOf(wf, t)
    if (c) checkpoints.set(c, (checkpoints.get(c) ?? 0) + 1)
  }
  for (const [stage, n] of stages) {
    if (wip[stage]?.limit != null) n.count = wip[stage]!.count
    n.state = n.bar.human ? 'attention' : n.bar.working ? 'active' : 'idle'
  }
  return { stages, checkpoints }
}

export type StageAgents = { role: { id: string; title: string; avatar: string }; working: number; idle: number; runner: number; ci: number; text: string | null; missing: boolean }

/**
 * Who is stationed at each stage that names a role: the role's sessions working a Ticket in the stage, its idle sessions, and the Runner or CI Runs working there.
 * `text` is "2 working · 1 idle", "Runner working" or, for a session-mode stage nobody serves, "No agent connected" (`missing`); null for an autonomous stage at rest.
 */
export const stageAgents = (wf: Workflow, roles: TeamRole[], modeOf: (stage: string) => Mode): Map<string, StageAgents> => {
  const out = new Map<string, StageAgents>()
  for (const s of wf.stages) {
    const role = s.role ? roles.find((r) => r.id === s.role) : undefined
    if (!role) continue
    const working = role.sessions.filter((x) => x.status === 'working' && x.ticket?.stage === s.name).length
    const idle = role.sessions.filter((x) => x.status === 'idle').length
    const runs = role.autonomous.filter((a) => a.ticket.stage === s.name)
    const ci = runs.filter((a) => a.executor === 'ci').length
    const runner = runs.length - ci
    const parts = [working && `${working} working`, idle && `${idle} idle`, runner && 'Runner working', ci && 'CI working'].filter(Boolean) as string[]
    const missing = !parts.length && modeOf(s.name) === 'session' && !role.sessions.some((x) => x.status !== 'offline')
    out.set(s.name, { role: { id: role.id, title: role.title, avatar: role.avatar }, working, idle, runner, ci, text: missing ? 'No agent connected' : parts.join(' · ') || null, missing })
  }
  return out
}
