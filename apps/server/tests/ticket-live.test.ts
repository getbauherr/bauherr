import { describe, expect, it } from 'vitest'
import { ticketStatus, type StatusRow } from '../src/app/(app)/lib/status'
import { nextStep } from '../src/lib/next-step'
import { ciWait, ticketLive } from '../src/lib/ticket-live'
import { DEFAULT } from '../src/lib/workflow'

const wf = DEFAULT()
const now = +new Date('2026-01-01T01:00:00Z')
const running = { id: 7, stage: 'build', status: 'running', startedAt: '2026-01-01T00:57:00Z' }
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
    const live = ticketLive({ ci: true, run: running }, now)!
    expect(live).toMatchObject({ chip: 'Waiting for CI', sentence: 'Waiting for CI.' })
    const s = ticketStatus(wf, row(stage, track), now)
    const step = nextStep({ wf, ticket: { stage, ...track }, need: null, run: { ...running, stage }, waiting: null, blockers: [], admin: false })
    expect(s.label).toBe('Waiting for CI')
    expect(step).toMatchObject({ label: 'Waiting for CI', enabled: false })
    expect(step.reason).toContain('Waiting for CI')
    for (const text of [live.chip, live.sentence, s.label, s.detail ?? '', step.label, step.reason]) expect(text).not.toMatch(lie)
  })
  it('a CI wait without a running Run still reads Waiting for CI', () =>
    expect(nextStep({ wf, ticket: { stage: 'review', reviewState: 'waiting_checks' }, need: null, run: null, waiting: null, blockers: [], admin: false })).toMatchObject({ label: 'Waiting for CI', reason: 'Waiting for CI.' }))
  it('review waiting_checks outside review is not a CI wait', () => expect(ciWait(wf, 'build', { reviewState: 'waiting_checks' })).toBe(false))
  it('a running Run without a wait is Working', () => {
    expect(ticketLive({ ci: false, run: running }, now)).toMatchObject({ chip: 'Working', tone: 'accent', sentence: 'Working. Started 3 min ago.' })
    expect(ticketLive({ ci: false, run: { status: 'queued' } }, now)).toBeNull()
  })
  it('known counts make the chip and sentence carry them; a needs-you Ticket never reads Waiting for CI', () => {
    const counts = { passed: 1, total: 2, pending: 1 }
    expect(ticketLive({ ci: true, run: running, counts }, now)).toMatchObject({ chip: 'Waiting for CI 1/2', sentence: expect.stringContaining('1 of 2 checks passed') })
    const step = nextStep({ wf, ticket: { stage: 'build', waitingFor: 'checks' }, need: 'Approve plan', run: running, waiting: null, blockers: [], admin: false, ci: counts })
    expect(step.label).toBe('Approve plan')
  })
  describe('a Step reported as waiting_ci', () => {
    const words = 'pipeline 4411 on the MR'
    const counts = { passed: 2, total: 3, pending: 1 }
    const waiting = { ...running, waitingStep: words }
    it('reads Waiting for CI with the agent words, same on every surface', () => {
      const live = ticketLive({ ci: false, run: waiting, counts }, now)!
      expect(live).toMatchObject({ chip: 'Waiting for CI 2/3', sentence: `Waiting for CI: ${words}` })
      const s = ticketStatus(wf, { ...row('build', {}), ci: counts, run: { ...row('build', {}).run!, waitingStep: words } }, now)
      const step = nextStep({ wf, ticket: { stage: 'build' }, need: null, run: waiting, waiting: null, blockers: [], admin: false, ci: counts })
      expect([s.phase, s.label, step.label]).toEqual(['ci', live.chip, live.chip])
      expect(s.detail).toBe(words)
      expect(step).toMatchObject({ enabled: false, reason: `Waiting for CI: ${words}.` })
    })
    it('without counts the chip is plain Waiting for CI; no waiting Step stays Working', () => {
      expect(ticketLive({ ci: false, run: waiting }, now)).toMatchObject({ chip: 'Waiting for CI', sentence: `Waiting for CI: ${words}` })
      expect(ticketLive({ ci: false, run: { ...running, waitingStep: null } }, now)).toMatchObject({ chip: 'Working' })
      expect(ticketStatus(wf, { ...row('build', {}), run: { ...row('build', {}).run!, waitingStep: null } }, now).label).toBe('In progress')
    })
    it('a Run that is not running is not waiting', () => expect(ticketLive({ ci: false, run: { status: 'queued', waitingStep: words } }, now)).toBeNull())
  })
})
