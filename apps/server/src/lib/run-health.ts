import { ago, duration } from '../app/(app)/lib/format'
import { ciSummaryOf } from './ci-summary'
import { pendingCounts, waitingChip } from './ci-text'
import { sessionHealth } from './sessions'
import { ciWait } from './ticket-live'
import { roleOf, type Workflow } from './workflow'

export type RunHealthState = 'queued' | 'awaiting_session' | 'waiting_ci' | 'waiting_review' | 'working' | 'stuck' | 'session_gone' | 'succeeded' | 'failed' | 'cancelled' | 'needs_human' | 'budget_exhausted' | 'abandoned'
export type RunAction = null | { kind: 'connect'; href: string } | { kind: 'release' } | { kind: 'rerun'; stage: string } | { kind: 'open_ticket'; href: string }
export type RunHealth = { state: RunHealthState; chip: string; tone: 'neutral' | 'muted' | 'accent' | 'ok' | 'warn' | 'destructive'; sentence: string; action: RunAction }

type RunIn = { status: string; stage: string; mode: string; startedAt?: string | null; finishedAt?: string | null; heartbeatAt?: string | null; sessionLabel?: string | null; error?: string | null; outcome?: string | null; reasonKind?: string | null; costUsd?: number | null }
type SessionIn = { label?: string | null; lastSeenAt?: string | null; disconnectedAt?: string | null; endReason?: string | null }
type TicketIn = { id: number; waitingFor?: string | null; reviewState?: string | null; ciSummary?: unknown; releaseChecksState?: string | null }
export type RunProgress = { done: number; total: number; lastReportAt?: string | null }

const END_WORD: Record<string, string> = { disconnect: 'disconnected', timeout: 'timed out', replaced: 'was replaced' }
const firstLine = (s?: string | null) => s?.split('\n')[0]?.trim() ?? ''
const latest = (...d: (string | null | undefined)[]) => d.filter(Boolean).sort().pop() ?? null

export const runHealth = (a: { run: RunIn; session: SessionIn | null; ticket: TicketIn; connected: number; isAdmin: boolean; now: number; timeoutS: number; wf: Workflow; progress?: RunProgress | null }): RunHealth => {
  const { run, session, ticket, now, isAdmin } = a
  const rel = (iso: string | null | undefined) => (iso ? ago(iso, now) : 'a while ago')
  const mk = (state: RunHealthState, chip: string, tone: RunHealth['tone'], sentence: string, action: RunAction = null): RunHealth => ({ state, chip, tone, sentence, action })
  const rerun: RunAction = { kind: 'rerun', stage: run.stage }
  const openTicket: RunAction = { kind: 'open_ticket', href: `/tickets/${ticket.id}` }
  switch (run.status) {
    case 'queued':
      return mk('queued', 'Queued', 'neutral', 'Queued. Starts when a runner is free.')
    case 'awaiting_session': {
      const role = roleOf(a.wf, run.stage)
      const title = role?.title ?? run.stage
      return a.connected > 0
        ? mk('awaiting_session', 'Waiting for a session', 'neutral', `Waiting for a ${title} agent to pick this up.`)
        : mk('awaiting_session', 'Waiting for a session', 'warn', `No ${title} agent is connected.`, { kind: 'connect', href: role ? `/team?role=${encodeURIComponent(role.id)}` : '/team' })
    }
    case 'running': {
      const release: RunAction = isAdmin ? { kind: 'release' } : null
      const adminNote = isAdmin ? '' : ' An Admin can release it.'
      const label = session?.label ?? run.sessionLabel
      const name = label ? `Session \`${label}\`` : 'The session'
      if (run.mode === 'session') {
        const seen = latest(run.heartbeatAt, session?.lastSeenAt)
        const health = sessionHealth({ hasRun: true, lastSeenAt: seen, disconnectedAt: session?.disconnectedAt ?? null }, now, a.timeoutS)
        if (health === 'disconnected') return mk('session_gone', 'Session gone', 'warn', `${name} ${END_WORD[session?.endReason ?? ''] ?? 'disconnected'} ${rel(session?.disconnectedAt)}.${adminNote}`, release)
        if (health === 'stuck') {
          const min = seen ? Math.max(0, Math.round((now - +new Date(seen)) / 60000)) : null
          return mk('stuck', 'Stuck', 'warn', `Not responding${min === null ? '' : ` for ${min} min`}. ${name} last seen ${rel(seen)}.${adminNote}`, release)
        }
      }
      if (ciWait(a.wf, run.stage, ticket)) {
        const c = pendingCounts(ciSummaryOf(ticket, now)?.summary)
        return c
          ? mk('waiting_ci', waitingChip(c), 'neutral', `Waiting for CI: ${c.total - c.pending} of ${c.total} checks done. The agent resumes when they finish.`)
          : mk('waiting_ci', 'Waiting for CI', 'neutral', 'Waiting for CI.')
      }
      if (ticket.reviewState === 'requested') return mk('waiting_review', 'Waiting for review', 'neutral', 'Review requested. Waiting for the reviewer.')
      const p = a.progress
      const min = run.startedAt ? Math.max(0, Math.round((now - +new Date(run.startedAt)) / 60000)) : null
      return mk('working', 'Working', 'accent', p && p.total > 0 && p.done > 0
        ? `Working on plan step ${Math.min(p.done + 1, p.total)} of ${p.total}. Last report ${rel(p.lastReportAt)}.`
        : `Working. No report yet${min === null ? '' : `, started ${min} min ago`}.`)
    }
    case 'succeeded': {
      const took = run.startedAt && run.finishedAt ? ` in ${duration((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000)}` : ''
      return mk('succeeded', 'Succeeded', 'ok', `Finished ${rel(run.finishedAt)}${took}.${run.outcome ? ` ${run.outcome}.` : ''}`)
    }
    case 'failed':
      return mk('failed', 'Failed', 'destructive', [firstLine(run.error), `Re-run ${run.stage} starts a new Run.`].filter(Boolean).join(' '), rerun)
    case 'cancelled':
      return mk('cancelled', 'Cancelled', 'muted', `Cancelled ${rel(run.finishedAt)}.`, rerun)
    case 'needs_human': {
      const kind = run.reasonKind === 'decision' ? 'Needs a decision' : run.reasonKind === 'access' ? 'Needs access' : ''
      const why = firstLine(run.error)
      return mk('needs_human', 'Waiting for you', 'warn', kind && why ? `${kind}: ${why}` : kind || why || 'Waiting for you.', openTicket)
    }
    case 'budget_exhausted':
      return mk('budget_exhausted', 'Budget exhausted', 'warn', `Stopped at the budget cap${isAdmin && run.costUsd != null ? ` ($${run.costUsd.toFixed(2)} spent)` : ''}.`, openTicket)
    default:
      return mk('abandoned', 'Abandoned', 'muted', 'No session claimed this Run.', rerun)
  }
}
