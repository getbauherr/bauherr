import { describe, expect, it } from 'vitest'
import { runHealth } from '../src/lib/run-health'
import { DEFAULT } from '../src/lib/workflow'

const now = Date.parse('2026-11-16T12:00:00Z')
const at = (min: number) => new Date(now - min * 60000).toISOString()
const wf = DEFAULT()
const base = { run: { status: 'running', stage: 'build', mode: 'session', startedAt: at(3), heartbeatAt: at(1), sessionLabel: 'eng-2a1' }, session: { label: 'eng-2a1', lastSeenAt: at(1) } as Record<string, any> | null, ticket: { id: 7 } as Record<string, any>, connected: 0, isAdmin: false, now, timeoutS: 600, wf }
const h = (over: { run?: Record<string, any>; session?: Record<string, any> | null; ticket?: Record<string, any>; connected?: number; isAdmin?: boolean; progress?: { done: number; total: number; lastReportAt?: string } } = {}) =>
  runHealth({ ...base, ...over, run: { ...base.run, ...over.run }, ticket: { ...base.ticket, ...over.ticket } } as Parameters<typeof runHealth>[0])
const ci = { total: 3, passed: 2, pending: 1, failed: [], url: null, updatedAt: at(0), rows: [] }

describe('runHealth, one case per row of the header table', () => {
  it('queued', () => expect(h({ run: { status: 'queued' } })).toMatchObject({ state: 'queued', chip: 'Queued', sentence: 'Queued. Starts when a runner is free.', action: null }))
  it('awaiting_session with no agent of the role connected is warn and offers Connect an agent', () =>
    expect(h({ run: { status: 'awaiting_session' } })).toMatchObject({ state: 'awaiting_session', chip: 'Waiting for a session', tone: 'warn', sentence: 'No Software engineer agent is connected.', action: { kind: 'connect', href: '/team?role=engineer' } }))
  it('awaiting_session with agents connected is neutral and has no action', () =>
    expect(h({ run: { status: 'awaiting_session' }, connected: 2 })).toMatchObject({ tone: 'neutral', sentence: 'Waiting for a Software engineer agent to pick this up.', action: null }))
  it('waiting_ci shows n/m, the sentence and no action', () =>
    expect(h({ ticket: { waitingFor: 'checks', ciSummary: ci } })).toEqual({ state: 'waiting_ci', chip: 'Waiting for CI 2/3', tone: 'neutral', sentence: 'Waiting for CI: 2 of 3 checks done. The agent resumes when they finish.', action: null }))
  it('waiting_ci without a stored summary still says so', () => expect(h({ ticket: { waitingFor: 'checks' } })).toMatchObject({ state: 'waiting_ci', chip: 'Waiting for CI', action: null }))
  it('waiting_review', () => expect(h({ ticket: { reviewState: 'requested' } })).toMatchObject({ state: 'waiting_review', chip: 'Waiting for review', sentence: 'Review requested. Waiting for the reviewer.', action: null }))
  it('working without a report yet', () => expect(h()).toEqual({ state: 'working', chip: 'Working', tone: 'accent', sentence: 'Working. No report yet, started 3 min ago.', action: null }))
  it('working on the next plan step once a milestone exists', () =>
    expect(h({ progress: { done: 2, total: 5, lastReportAt: at(2) } }).sentence).toBe('Working on plan step 3 of 5. Last report 2 min ago.'))
  it('a healthy Run never offers Release lock, even to an Admin', () => expect(h({ isAdmin: true }).action).toBeNull())
  it('a fresh run heartbeat keeps a quiet session healthy', () => expect(h({ session: { label: 'eng-2a1', lastSeenAt: at(30) } }).state).toBe('working'))
  describe('stuck', () => {
    const stale = { run: { heartbeatAt: at(14) }, session: { label: 'eng-2a1', lastSeenAt: at(14) } }
    it('Admin gets Release lock', () => expect(h({ ...stale, isAdmin: true })).toEqual({ state: 'stuck', chip: 'Stuck', tone: 'warn', sentence: 'Not responding for 14 min. Session `eng-2a1` last seen 14 min ago.', action: { kind: 'release' } }))
    it('non-Admin gets no action and is told an Admin can release it', () =>
      expect(h(stale)).toMatchObject({ state: 'stuck', sentence: 'Not responding for 14 min. Session `eng-2a1` last seen 14 min ago. An Admin can release it.', action: null }))
    it('wins over a CI wait', () => expect(h({ ...stale, ticket: { waitingFor: 'checks', ciSummary: ci } }).state).toBe('stuck'))
    it('falls back to the Run label without a session row', () => expect(h({ run: { heartbeatAt: at(14) }, session: null }).sentence).toContain('Session `eng-2a1`'))
  })
  describe('session_gone', () => {
    const gone = (endReason: string, isAdmin = false) => h({ isAdmin, session: { label: 'eng-2a1', lastSeenAt: at(5), disconnectedAt: at(4), endReason } })
    it('Admin gets Release lock', () => expect(gone('disconnect', true)).toEqual({ state: 'session_gone', chip: 'Session gone', tone: 'warn', sentence: 'Session `eng-2a1` disconnected 4 min ago.', action: { kind: 'release' } }))
    it('non-Admin gets no action and the Admin hint', () => expect(gone('disconnect')).toMatchObject({ sentence: 'Session `eng-2a1` disconnected 4 min ago. An Admin can release it.', action: null }))
    it('names the end reason in words', () => {
      expect(gone('timeout').sentence).toContain('timed out 4 min ago')
      expect(gone('replaced').sentence).toContain('was replaced 4 min ago')
    })
  })
  it('succeeded', () => expect(h({ run: { status: 'succeeded', startedAt: at(20), finishedAt: at(2), outcome: 'MR opened' } })).toMatchObject({ state: 'succeeded', chip: 'Succeeded', tone: 'ok', sentence: 'Finished 2 min ago in 18 min. MR opened.', action: null }))
  it('failed shows the first error line and Re-run', () =>
    expect(h({ run: { status: 'failed', error: 'tests failed\nstack trace' } })).toMatchObject({ state: 'failed', tone: 'destructive', sentence: 'tests failed Re-run build starts a new Run.', action: { kind: 'rerun', stage: 'build' } }))
  it('cancelled', () => expect(h({ run: { status: 'cancelled', finishedAt: at(5) } })).toMatchObject({ state: 'cancelled', sentence: 'Cancelled 5 min ago.', action: { kind: 'rerun', stage: 'build' } }))
  it('needs_human opens the Ticket and never offers Re-run', () =>
    expect(h({ run: { status: 'needs_human', reasonKind: 'decision', error: 'Which API?' } })).toMatchObject({ state: 'needs_human', chip: 'Waiting for you', tone: 'warn', sentence: 'Needs a decision: Which API?', action: { kind: 'open_ticket', href: '/tickets/7' } }))
  it('budget_exhausted links the Ticket; only an Admin sees the amount', () => {
    const run = { status: 'budget_exhausted', costUsd: 4.5 }
    expect(h({ run })).toMatchObject({ state: 'budget_exhausted', sentence: 'Stopped at the budget cap.', action: { kind: 'open_ticket', href: '/tickets/7' } })
    expect(h({ run, isAdmin: true }).sentence).toBe('Stopped at the budget cap ($4.50 spent).')
  })
  it('abandoned', () => expect(h({ run: { status: 'abandoned' } })).toMatchObject({ state: 'abandoned', chip: 'Abandoned', sentence: 'No session claimed this Run.', action: { kind: 'rerun', stage: 'build' } }))
  it('an autonomous running Run is judged by its work, not by a session', () => expect(h({ run: { mode: 'autonomous', heartbeatAt: at(60) }, session: null }).state).toBe('working'))
})
