import type { Span } from '../../../lib/history'
import { stage as stageDef, title, type Workflow } from '../../../lib/workflow'
import { hasJobs, stageJobs } from './job-view'
import type { TicketPath } from '../components/workflow/WorkflowGraph'
import { phaseLabel } from './status'

type Doc = Record<string, any>

export type StepRun = {
  id: number
  executor: 'Session' | 'Runner' | 'CI' | null
  role: string | null
  sessionLabel: string | null
  sessionId: string | null
  client: string | null
  model: string | null
  provider: string | null
  mode: string
  status: string
  outcome: string | null
  verdict: string | null
  reason: string | null
  cost: string | null
  usage: string | null
}
export type Step = { id: number; phase: string; label: string; at: string; seconds: number; /** The workflow version the step ran under, only when it is not the one active now. */ workflowVersion: number | null; run: StepRun | null; ci: { provider: string | null; url: string | null } | null; decision: { what: string; actor: string | null } | null; /** "Sent back to <stage> by <person>: <why>" on the step a send back started. */ sentBack: string | null }
export type Visit = { stage: string; title: string; at: string; seconds: number; steps: Step[]; jobs?: JobRow[] }
export type Row = { stage: string; title: string; run: StepRun | null; steps: Step[]; seconds: number; at: string; jobs?: JobRow[] }

export const sentBackText = (wf: Workflow, s: Pick<Span, 'cause' | 'stage' | 'actor' | 'note' | 'outcome'>): string | null =>
  s.cause === 'sendBack' && s.stage ? `Sent back to ${s.outcome === 'backlog' ? 'the backlog' : title(wf, s.stage)} by ${s.actor ?? 'the owner'}${s.note ? `: ${s.note}` : '.'}` : null

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
  if (v.jobs?.length && rows.length) rows.at(-1)!.jobs = v.jobs
  return rows
}

export type Skipped = { stage: string; title: string; at: string; reason: string; job: string | null }
export type Steps = { visits: Visit[]; skipped: Skipped[]; path: TicketPath; totals: { lead: number; human: number; working: number; ci: number; queued: number }; rounds: { stage: string; title: string; n: number }[] }

const first = (s: unknown) => (typeof s === 'string' ? s.split('\n')[0]!.trim().slice(0, 160) || null : null)

const cost = (r: Doc): string | null =>
  r.reconcileStatus === 'unpriced' ? `${r.gatewayTokensTotal ?? 0} tokens, unpriced` : r.costUsd != null ? `$${Number(r.costUsd).toFixed(2)}, ${r.tokensIn ?? 0} in / ${r.tokensOut ?? 0} out tokens` : null

const usage = (r: Doc): string | null => [r.costUsd != null && '$' + Number(r.costUsd).toFixed(2), r.gatewayTokensTotal && Number(r.gatewayTokensTotal).toLocaleString('en') + ' tokens'].filter(Boolean).join(' · ') || null

const stepRun = (wf: Workflow, r: Doc, o: { admin: boolean; sessions?: Map<number, string> }, outcome: string | null = null): StepRun => ({
  id: r.id, executor: r.executor === 'session' || r.mode === 'session' ? 'Session' : r.executor === 'ci' ? 'CI' : r.executor || r.mode ? 'Runner' : null, role: wf.roles.find((x) => x.id === r.role)?.title ?? null, sessionLabel: r.sessionLabel ?? null, sessionId: o.sessions?.get(typeof r.session === 'object' ? r.session?.id : r.session) ?? null, client: [r.clientName, r.clientVersion].filter(Boolean).join(' ') || null, model: r.model ?? null, provider: r.provider ?? null, mode: r.mode, status: r.status, outcome: r.outcome ?? outcome, verdict: r.verdict ?? null, reason: first(r.error), cost: o.admin ? cost(r) : null, usage: o.admin ? usage(r) : null,
})

export type JobStatus = 'queued' | 'working' | 'done' | 'skipped' | 'failed' | 'cancelled' | 'needs_you' | 'waiting' | 'pending'
export const JOB_STATUS: Record<JobStatus, string> = { queued: 'Queued', working: 'Working', done: 'Done', skipped: 'Skipped', failed: 'Failed', cancelled: 'Cancelled', needs_you: 'Needs you', waiting: 'Waiting for you', pending: 'Not started' }
const RUN_STATUS: Record<string, JobStatus> = { queued: 'queued', awaiting_session: 'queued', running: 'working', succeeded: 'done', failed: 'failed', budget_exhausted: 'failed', cancelled: 'cancelled', needs_human: 'needs_you' }
export type JobRow = { id: string; title: string; kind: 'agent' | 'human'; status: JobStatus; reason: string | null; run: StepRun | null; seconds: number | null }

export const jobRowsOf = (wf: Workflow, v: Pick<Visit, 'stage' | 'at' | 'steps'>, until: string | null, runs: Doc[], skips: Skipped[], o: { admin: boolean; sessions?: Map<number, string>; now: number }): JobRow[] | undefined => {
  const def = stageDef(wf, v.stage)
  if (!def || !hasJobs(def)) return undefined
  const inside = (at: string) => at >= v.at && (!until || at < until)
  return stageJobs(def).flatMap((j): JobRow[] => {
    const base = { id: j.id, title: j.title, kind: j.kind, run: null, seconds: null, reason: null }
    if (j.kind === 'human') {
      const decided = v.steps.find((s) => s.decision)?.decision
      const waiting = v.steps.at(-1)?.phase === 'human'
      return decided ? [{ ...base, status: 'done', reason: `Decided: ${decided.what}${decided.actor ? ` by ${decided.actor}` : ''}` }] : waiting ? [{ ...base, status: 'waiting' }] : until ? [] : [{ ...base, status: 'pending' }]
    }
    const mine = runs.filter((r) => r.stage === v.stage && (r.job ?? def.jobs![0]!.id) === j.id && inside(r.createdAt)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]
    if (mine) {
      const from = mine.startedAt && +new Date(mine.startedAt)
      return [{ ...base, status: RUN_STATUS[mine.status] ?? 'pending', run: stepRun(wf, mine, o), seconds: from ? Math.max(0, ((mine.finishedAt ? +new Date(mine.finishedAt) : o.now) - from) / 1000) : null, reason: first(mine.error) }]
    }
    const skip = skips.find((k) => k.stage === v.stage && k.job === j.id && inside(k.at))
    return skip ? [{ ...base, status: 'skipped', reason: skip.reason }] : until ? [] : [{ ...base, status: 'pending' }]
  })
}

export const buildSteps = (wf: Workflow, spans: Span[], runs: Doc[], touches: Doc[], o: { current: string; provider: string | null; admin: boolean; sessions?: Map<number, string>; workflowVersion?: number | null; skips?: { stage: string; at: string; reason: string; job?: string | null }[]; now?: number }): Steps => {
  const skipped: Skipped[] = (o.skips ?? []).map((k) => ({ ...k, job: k.job ?? null, title: title(wf, k.stage) }))
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
      run: r ? stepRun(wf, r, o, s.outcome) : null,
      ci: s.phase === 'ci' ? { provider: o.provider, url: prUrl } : null,
      sentBack: sentBackText(wf, s),
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
  visits.forEach((v, i) => (v.jobs = jobRowsOf(wf, v, visits[i + 1]?.at ?? null, runs, skipped, { admin: o.admin, sessions: o.sessions, now: o.now ?? Date.now() })))
  const path: TicketPath = { visits: new Map(), current: o.current, taken: new Map() }
  visits.forEach((v, i) => {
    path.visits.set(v.stage, (path.visits.get(v.stage) ?? 0) + 1)
    if (i) path.taken.set(`${visits[i - 1]!.stage}>${v.stage}`, (path.taken.get(`${visits[i - 1]!.stage}>${v.stage}`) ?? 0) + 1)
  })
  return { visits, skipped: skipped.filter((k) => !k.job), path, totals, rounds: [...path.visits].filter(([, n]) => n > 1).map(([stage, n]) => ({ stage, title: title(wf, stage), n })) }
}
