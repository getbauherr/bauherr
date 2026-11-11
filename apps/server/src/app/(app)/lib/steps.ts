import type { Span } from '../../../lib/history'
import { title, type Workflow } from '../../../lib/workflow'
import type { TicketPath } from '../components/workflow/WorkflowGraph'
import { phaseLabel } from './status'

type Doc = Record<string, any>

export type StepRun = {
  id: number
  executor: 'Session' | 'Runner' | 'CI' | null
  /** Title of the role that worked the Run. */
  role: string | null
  sessionLabel: string | null
  /** Public id of the agent session (anchor on the Team page). */
  sessionId: string | null
  client: string | null
  model: string | null
  provider: string | null
  mode: string
  status: string
  outcome: string | null
  verdict: string | null
  reason: string | null
  /** Admin only. */
  cost: string | null
  /** Admin only: cost and tokens in one short phrase for the compact row. */
  usage: string | null
}
export type Step = { id: number; phase: string; label: string; at: string; seconds: number; /** The workflow version the step ran under, only when it is not the one active now. */ workflowVersion: number | null; run: StepRun | null; ci: { provider: string | null; url: string | null } | null; decision: { what: string; actor: string | null } | null }
export type Visit = { stage: string; title: string; at: string; seconds: number; steps: Step[] }
/** One Run of a visit with its phases in order; a phase without a Run (queued before the claim) joins the next Run's row. */
export type Row = { stage: string; title: string; run: StepRun | null; steps: Step[]; seconds: number; at: string }

export const rowsOf = (v: Visit): Row[] => {
  const rows: Row[] = []
  let loose: Step[] = []
  const add = (row: Row, ...steps: Step[]) => {
    row.steps.push(...steps)
    row.seconds += steps.reduce((n, s) => n + s.seconds, 0)
  }
  for (const s of v.steps) {
    if (!s.run) {
      loose.push(s)
      continue
    }
    const last = rows.at(-1)
    if (last?.run?.id === s.run.id) add(last, s)
    else {
      const row: Row = { stage: v.stage, title: v.title, run: s.run, steps: [], seconds: 0, at: loose[0]?.at ?? s.at }
      add(row, ...loose, s)
      rows.push(row)
    }
    loose = []
  }
  if (loose.length) {
    const last = rows.at(-1)
    if (last) add(last, ...loose)
    else rows.push({ stage: v.stage, title: v.title, run: null, steps: loose, seconds: loose.reduce((n, s) => n + s.seconds, 0), at: loose[0]!.at })
  }
  return rows
}

export type Steps = { visits: Visit[]; path: TicketPath; totals: { lead: number; human: number; working: number; ci: number; queued: number }; rounds: { stage: string; title: string; n: number }[] }

const first = (s: unknown) => (typeof s === 'string' ? s.split('\n')[0]!.trim().slice(0, 160) || null : null)

const cost = (r: Doc): string | null =>
  r.reconcileStatus === 'unpriced' ? `${r.gatewayTokensTotal ?? 0} tokens, unpriced` : r.costUsd != null ? `$${Number(r.costUsd).toFixed(2)}, ${r.tokensIn ?? 0} in / ${r.tokensOut ?? 0} out tokens` : null

const usage = (r: Doc): string | null => [r.costUsd != null && '$' + Number(r.costUsd).toFixed(2), r.gatewayTokensTotal && Number(r.gatewayTokensTotal).toLocaleString('en') + ' tokens'].filter(Boolean).join(' · ') || null

/**
 * The Ticket's route and steps from its history: spans of one stage form a visit, a visit is entered from the previous one (the transitions taken), steps are the phases inside it.
 * Runs add who ran a step, a human step names who decided what (the event after it carries `gate:<what>` and the actor, else the matching `human_touches` row), a CI step names the provider and links the MR.
 */
export const buildSteps = (wf: Workflow, spans: Span[], runs: Doc[], touches: Doc[], o: { current: string; provider: string | null; admin: boolean; sessions?: Map<number, string>; workflowVersion?: number | null }): Steps => {
  const byRun = new Map(runs.map((r) => [r.id as number, r]))
  const prUrl = runs.find((r) => r.artifacts?.prUrl)?.artifacts.prUrl ?? null
  const visits: Visit[] = []
  const totals = { lead: 0, human: 0, working: 0, ci: 0, queued: 0 }
  spans.forEach((s, i) => {
    if (!s.stage) return
    const r = s.run ? byRun.get(s.run) : undefined
    const next = spans[i + 1]
    const gate = s.phase === 'human' && next?.cause?.startsWith('gate:') ? next.cause.slice(5) : null
    const touch = gate ? touches.find((t) => t.kind === gate) : null
    const step: Step = {
      id: s.id, phase: s.phase, label: phaseLabel(s.phase, s.stageKind), at: s.at, seconds: s.seconds, workflowVersion: s.workflowVersion != null && s.workflowVersion !== (o.workflowVersion ?? null) ? s.workflowVersion : null,
      run: r ? { id: r.id, executor: r.executor === 'session' || r.mode === 'session' ? 'Session' : r.executor === 'ci' ? 'CI' : r.executor || r.mode ? 'Runner' : null, role: wf.roles.find((x) => x.id === r.role)?.title ?? null, sessionLabel: r.sessionLabel ?? null, sessionId: o.sessions?.get(typeof r.session === 'object' ? r.session?.id : r.session) ?? null, client: [r.clientName, r.clientVersion].filter(Boolean).join(' ') || null, model: r.model ?? null, provider: r.provider ?? null, mode: r.mode, status: r.status, outcome: r.outcome ?? s.outcome, verdict: r.verdict ?? null, reason: first(r.error), cost: o.admin ? cost(r) : null, usage: o.admin ? usage(r) : null } : null,
      ci: s.phase === 'ci' ? { provider: o.provider, url: prUrl } : null,
      decision: gate ? { what: gate.replace(/:/g, ' '), actor: next?.actor ?? touch?.actor ?? null } : null,
    }
    const last = visits[visits.length - 1]
    if (last && last.stage === s.stage) {
      last.steps.push(step)
      last.seconds += s.seconds
    } else visits.push({ stage: s.stage, title: title(wf, s.stage), at: s.at, seconds: s.seconds, steps: [step] })
    if (s.phase !== 'closed') totals[s.phase === 'human' ? 'human' : s.phase === 'working' ? 'working' : s.phase === 'ci' ? 'ci' : 'queued'] += s.seconds
  })
  if (spans.length) totals.lead = (+new Date(spans[spans.length - 1]!.until) - +new Date(spans[0]!.at)) / 1000
  const path: TicketPath = { visits: new Map(), current: o.current, taken: new Map() }
  visits.forEach((v, i) => {
    path.visits.set(v.stage, (path.visits.get(v.stage) ?? 0) + 1)
    if (i) path.taken.set(`${visits[i - 1]!.stage}>${v.stage}`, (path.taken.get(`${visits[i - 1]!.stage}>${v.stage}`) ?? 0) + 1)
  })
  return { visits, path, totals, rounds: [...path.visits].filter(([, n]) => n > 1).map(([stage, n]) => ({ stage, title: title(wf, stage), n })) }
}
