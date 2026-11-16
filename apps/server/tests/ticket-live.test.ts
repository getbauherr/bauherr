import { describe, expect, it } from 'vitest'
import { ticketStatus, type StatusRow } from '../src/app/(app)/lib/status'
import { nextStep } from '../src/lib/next-step'
import { ciWait, forgeButton, ticketLive } from '../src/lib/ticket-live'
import { DEFAULT } from '../src/lib/workflow'

const wf = DEFAULT()
const now = +new Date('2026-01-01T01:00:00Z')
const running = { id: 7, stage: 'build', status: 'running', startedAt: '2026-01-01T00:57:00Z' }
const PR = 'https://github.com/o/r/pull/88'
const MR = 'https://gitlab.com/o/r/-/merge_requests/88'
const waits: [string, string, Record<string, string>][] = [
  ['waitingFor checks', 'build', { waitingFor: 'checks' }],
  ['reviewState waiting_checks', 'review', { reviewState: 'waiting_checks' }],
  ['releaseChecksState waiting', 'release', { releaseChecksState: 'waiting' }],
]
const row = (stage: string, track: Record<string, string>): StatusRow => ({ open: true, stage, needsYou: null, blockedBy: [], queuedWhy: null, run: { ...running, stage, mode: 'autonomous', createdAt: running.startedAt }, owner: null, forge: 'github', gate: null, track })
const lie = /building|working on this/i

describe('ticketLive', () => {
  it.each(waits)('%s with a running Run says Waiting for CI everywhere', (_n, stage, track) => {
    expect(ciWait(wf, stage, track)).toBe(true)
    const live = ticketLive({ ci: true, run: running, forge: 'github', prUrl: PR }, now)!
    expect(live).toMatchObject({ chip: 'Waiting for CI', forge: { label: 'Open pull request #88 on GitHub', href: PR } })
    const s = ticketStatus(wf, row(stage, track), now)
    const step = nextStep({ wf, ticket: { stage, ...track }, need: null, run: { ...running, stage }, waiting: null, blockers: [], admin: false, forge: 'github', prUrl: PR })
    expect(s.label).toBe('Waiting for CI')
    expect(step).toMatchObject({ label: 'Waiting for CI', enabled: false, forge: { href: PR } })
    expect(step.reason).toContain('Waiting for CI')
    for (const text of [live.chip, live.sentence, s.label, s.detail ?? '', step.label, step.reason]) expect(text).not.toMatch(lie)
  })
  it('a CI wait without a running Run still gets the forge button, not a primary', () =>
    expect(nextStep({ wf, ticket: { stage: 'review', reviewState: 'waiting_checks' }, need: null, run: null, waiting: null, blockers: [], admin: false, forge: 'gitlab', prUrl: MR })).toMatchObject({ label: 'Waiting for CI', reason: 'Waiting for CI.', forge: { label: 'Open merge request !88 on GitLab' } }))
  it('review waiting_checks outside review is not a CI wait', () => expect(ciWait(wf, 'build', { reviewState: 'waiting_checks' })).toBe(false))
  it('a running Run without a wait is Working', () => {
    expect(ticketLive({ ci: false, run: running }, now)).toMatchObject({ chip: 'Working', tone: 'accent', sentence: 'Working. Started 3 min ago.', forge: null })
    expect(ticketLive({ ci: false, run: { status: 'queued' } }, now)).toBeNull()
  })
  it('forge button label per kind, absent without a URL', () => {
    expect(forgeButton('gitlab', MR)).toEqual({ label: 'Open merge request !88 on GitLab', href: MR })
    expect(forgeButton(null, MR)).toEqual({ label: 'Open merge request', href: MR })
    expect(forgeButton('github', null)).toBeNull()
    expect(ticketLive({ ci: true, run: running, forge: 'github' }, now)).toMatchObject({ sentence: 'Waiting for CI.', forge: null })
  })
})
