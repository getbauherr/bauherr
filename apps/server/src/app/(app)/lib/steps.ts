import type { Span } from '../../../lib/history'
import { title, type Workflow } from '../../../lib/workflow'
import type { TicketPath } from '../components/workflow/WorkflowGraph'
import { phaseLabel } from './status'

type Doc = Record<string, any>

export type StepRun = {
  id: number
  executor: 'Session' | 'Runner' | null
  sessionLabel: string | null
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
}
export type Step = { id: number; phase: string; label: string; at: string; seconds: number; run: StepRun | null; ci: { provider: string | null; url: string | null } | null; decision: { what: string; actor: string | null } | null }
export type Visit = { stage: string; title: string; at: string; seconds: number; steps: Step[] }
export type Steps = { visits: Visit[]; path: TicketPath; totals: { lead: number; human: number; working: number; ci: number; queued: number }; rounds: { stage: string; title: string; n: number }[] }

const first = (s: unknown) => (typeof s === 'string' ? s.split('\n')[0]!.trim().slice(0, 160) || null : null)

const cost = (r: Doc): string | null =>
  r.reconcileStatus === 'unpriced' ? `${r.gatewayTokensTotal ?? 0} tokens, unpriced` : r.costUsd != null ? `$${Number(r.costUsd).toFixed(2)}, ${r.tokensIn ?? 0} in / ${r.tokensOut ?? 0} out tokens` : null

/**
 * The Ticket's route and steps from its history: spans of one stage form a visit, a visit is entered from the previous one (the transitions taken), steps are the phases inside it.
 * Runs add who ran a step, a human step names who decided what (the event after it carries `gate:<what>` and the actor, else the matching `human_touches` row), a CI step names the provider and links the MR.
 */
export const buildSteps = (wf: Workflow, spans: Span[], runs: Doc[], touches: Doc[], o: { current: string; provider: string | null; admin: boolean }): Steps => {
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
      id: s.id, phase: s.phase, label: phaseLabel(s.phase, s.stageKind), at: s.at, seconds: s.seconds,
      run: r ? { id: r.id, executor: r.executor === 'session' || r.mode === 'session' ? 'Session' : r.executor || r.mode ? 'Runner' : null, sessionLabel: r.sessionLabel ?? null, client: [r.clientName, r.clientVersion].filter(Boolean).join(' ') || null, model: r.model ?? null, provider: r.provider ?? null, mode: r.mode, status: r.status, outcome: r.outcome ?? s.outcome, verdict: r.verdict ?? null, reason: first(r.error), cost: o.admin ? cost(r) : null } : null,
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
