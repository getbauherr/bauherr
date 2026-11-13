import { WAITING_FOR_YOU } from '../../../lib/checkpoints'
import { kindOfRun } from '../../../lib/stage-text'
import { is, title as stageTitle, type Workflow } from '../../../lib/workflow'
import { duration } from './format'

export type StatusPhase = 'working' | 'queued' | 'human' | 'ci' | 'blocked' | 'failed' | 'done'
export type StatusTone = 'accent' | 'warn' | 'muted' | 'neutral' | 'destructive' | 'ok'
export type TicketStatus = { phase: StatusPhase; label: string; detail: string | null; who: string | null; tone: StatusTone }

export type StatusRun = {
  stage: string
  kind?: string | null
  status: string
  error?: string | null
  mode: string
  executor?: string | null
  /** Role id the Run was claimed for (`runs.role`). */
  role?: string | null
  sessionLabel?: string | null
  clientName?: string | null
  clientVersion?: string | null
  model?: string | null
  provider?: string | null
  startedAt?: string | null
  createdAt: string
  investigation?: unknown
  escalation?: { step: number; reason: string } | null
  /** Number of the hotfix Ticket this Run was paused for (`runs.preemptedFor`). */
  preemptedFor?: number | null
}
/** Ticket fields that say what the factory waits for between Runs. */
export type Track = { waitingFor?: string | null; reviewState?: string | null; releaseState?: string | null; productionState?: string | null; releaseChecksState?: string | null; releaseError?: string | null }
export type StatusRow = {
  open: boolean
  stage: string
  needsYou: string | null
  blockedBy: { number: number }[]
  /** Why the Ticket waits for a free slot ("Build is full (2/2)"), else null. */
  queuedWhy: string | null
  run: StatusRun | null
  /** Email local-part of the session owner of the Run. */
  owner: string | null
  forge: 'github' | 'gitlab' | null
  gate: { people: string[] } | null
  track: Track
  /** Sub-tickets of a split Ticket (stage of kind container). */
  children?: { total: number; done: number } | null
}

const VERB: Record<string, string> = { triage: 'triaging', plan: 'planning', build: 'building', review: 'reviewing', release: 'deploying', agent: 'working' }
const first = (s: string | null | undefined) => s?.split('\n')[0]?.trim().slice(0, 120) || null
const RUN_PROBLEMS = ['Cancelled', 'Run failed', 'Run needs you']

/** Who runs a Run: the session (label or owner, role, client, model) or the runner (model); "Runner" or "CI" with the role title when the Run has a role. */
export const runWho = (r: Pick<StatusRun, 'mode' | 'executor' | 'sessionLabel' | 'clientName' | 'clientVersion' | 'model'>, owner: string | null, roleTitle?: string | null): string => {
  const session = r.mode === 'session' || r.executor === 'session'
  const client = [r.clientName, r.clientVersion].filter(Boolean).join(' ')
  const as = roleTitle ? `(${roleTitle})` : null
  const head = session ? [`${r.sessionLabel || owner || 'Session'}${as ? ` ${as}` : ''}`, client] : [roleTitle ? `${r.executor === 'ci' ? 'CI' : 'Runner'} ${as}` : 'Bauherr runner']
  return [...head, r.model].filter(Boolean).join(' · ')
}

const ci = (wf: Workflow, r: StatusRow): { label: string; detail: string } | null => {
  const at = (k: 'review' | 'release') => is(wf, r.stage, k)
  const t = r.track
  if (t.waitingFor === 'checks') return { label: 'Waiting for CI', detail: 'checks of the merge request' }
  if (at('review') && t.reviewState === 'waiting_checks') return { label: 'Waiting for CI', detail: 'checks of the merge request' }
  if (at('review') && t.reviewState === 'queued') return { label: 'Waiting on merge queue', detail: 'the merge request is in the merge queue' }
  if (at('release') && t.releaseState === 'waiting') return { label: 'Waiting on deploy', detail: 'the staging deploy' }
  if (at('release') && t.productionState === 'deploying') return { label: 'Waiting on deploy', detail: 'the production deploy' }
  if (t.releaseChecksState === 'waiting') return { label: 'Waiting for CI', detail: 'the release checks' }
  return null
}

/**
 * The one status of a Ticket, shown identically on the Workflow view, the Ticket page, Epics and the chat. First match: Done; a Run of the Ticket's own stage
 * (running = In progress, queued or waiting for a session = Queued); Waiting for you; Waiting for CI / merge queue / deploy; Blocked; Failed; else Queued.
 */
export const ticketStatus = (wf: Workflow, r: StatusRow, now = Date.now()): TicketStatus => {
  const run = r.run && r.run.stage === r.stage ? r.run : null
  if (!r.open) return { phase: 'done', label: 'Done', detail: null, who: null, tone: 'ok' }
  // Still open on the forge in the done stage: awaiting close or archive.
  if (is(wf, r.stage, 'done')) return { phase: 'done', label: 'Done', detail: 'closing', who: null, tone: 'ok' }
  if (is(wf, r.stage, 'container')) {
    const c = r.children ?? { total: 0, done: 0 }
    return { phase: 'blocked', label: 'Split', detail: `into ${c.total} sub-ticket${c.total === 1 ? '' : 's'} (${c.done} done)`, who: null, tone: 'muted' }
  }
  if (run?.status === 'running') {
    const kind = kindOfRun(wf, run) ?? ''
    const since = run.startedAt ? ` for ${duration((now - +new Date(run.startedAt)) / 1000)}` : ''
    const extra = run.investigation ? ' · investigating' : run.escalation ? ` · escalated to the strong model (step ${run.escalation.step} of 4)` : ''
    return { phase: 'working', label: 'In progress', detail: `${VERB[kind] ?? 'running a step'}${since}${extra}`, who: runWho(run, r.owner, wf.roles.find((x) => x.id === run.role)?.title), tone: 'accent' }
  }
  if (run?.status === 'awaiting_session' && run.preemptedFor) return { phase: 'queued', label: `Paused for hotfix #${run.preemptedFor}`, detail: 'continues first when the hotfix is done', who: null, tone: 'muted' }
  if (run?.status === 'awaiting_session') return { phase: 'queued', label: 'Queued', detail: 'waiting for a session', who: null, tone: 'muted' }
  if (run?.status === 'queued') return { phase: 'queued', label: 'Queued', detail: r.queuedWhy ?? 'next in line', who: null, tone: 'muted' }
  if (r.needsYou) {
    const why = RUN_PROBLEMS.includes(r.needsYou) ? first(r.run?.error) : null
    return { phase: 'human', label: WAITING_FOR_YOU, detail: why ? `${r.needsYou}: ${why}` : r.needsYou === 'Decision needed' ? stageTitle(wf, r.stage) : r.needsYou, who: r.gate?.people.length ? r.gate.people.map((p) => `@${p}`).join(' ') : null, tone: 'warn' }
  }
  const wait = ci(wf, r)
  if (wait) return { phase: 'ci', label: wait.label, detail: wait.detail, who: r.forge === 'gitlab' ? 'GitLab CI' : r.forge === 'github' ? 'GitHub Actions' : null, tone: 'neutral' }
  if (r.track.releaseError) return { phase: 'failed', label: 'Failed', detail: `Release not published: ${first(r.track.releaseError)}`, who: null, tone: 'destructive' }
  if (r.blockedBy.length) return { phase: 'blocked', label: 'Blocked', detail: `by ${r.blockedBy.map((b) => `#${b.number}`).join(', ')}`, who: null, tone: 'muted' }
  if (run && ['failed', 'budget_exhausted'].includes(run.status)) return { phase: 'failed', label: 'Failed', detail: first(run.error) ?? (run.status === 'budget_exhausted' ? 'budget exhausted' : 'the Run failed'), who: null, tone: 'destructive' }
  return { phase: 'queued', label: 'Queued', detail: r.queuedWhy ?? 'next in line', who: null, tone: 'muted' }
}

/** `ticketStatus` against the current workflow, as one line: "In progress: building for 4 min". */
export const statusLine = (wf: Workflow, r: StatusRow): string => {
  const s = ticketStatus(wf, r)
  return s.detail ? `${s.label}: ${s.detail}` : s.label
}

/** The status label of a history phase (`ticket_events.phase`) in the stage of kind `stageKind`. */
export const phaseLabel = (phase: string, stageKind?: string | null): string =>
  ({ working: 'In progress', queued: 'Queued', human: WAITING_FOR_YOU, closed: 'Done', ci: stageKind === 'release' ? 'Waiting on deploy' : 'Waiting for CI' })[phase] ?? phase
