import { describe, expect, it } from 'vitest'
import { ticketStatus, type StatusRow } from '../src/app/(app)/lib/status'
import { nextStep } from '../src/lib/next-step'
import { ciWait, stepOf, ticketLive } from '../src/lib/ticket-live'
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
})

describe('ticketLive liveness and sentences', () => {
  const ago = (min: number) => new Date(now - min * 60000).toISOString()
  const sess = (health: string, extra = {}) => ({ publicId: 'eng-2a1', health, lastSeenAt: ago(14), ...extra })
  const table: [string, Parameters<typeof ticketLive>[0], { chip: string; sentence: string; release?: boolean }][] = [
    ['stuck, Admin', { ci: false, run: running, session: sess('stuck'), admin: true }, { chip: 'Stuck', sentence: 'Not responding for 14 min. Session eng-2a1 last seen 14 min ago.', release: true }],
    ['stuck, other', { ci: false, run: running, session: sess('stuck') }, { chip: 'Stuck', sentence: 'Not responding for 14 min. Session eng-2a1 last seen 14 min ago. An Admin can release it.', release: false }],
    ['disconnected, Admin', { ci: false, run: running, session: sess('disconnected', { disconnectedAt: ago(5), endReason: 'timeout' }), admin: true }, { chip: 'Session gone', sentence: 'Session eng-2a1 disconnected (timeout) 5 min ago.', release: true }],
    ['disconnected, other', { ci: false, run: running, session: sess('disconnected', { disconnectedAt: ago(5), endReason: 'disconnect' }) }, { chip: 'Session gone', sentence: 'Session eng-2a1 disconnected (disconnect) 5 min ago. An Admin can release it.', release: false }],
    ['stale session beats a step report', { ci: false, run: running, session: sess('stuck'), step: { n: 3, m: 5, at: ago(2) } }, { chip: 'Stuck', sentence: expect.stringContaining('Not responding') as never }],
    ['review requested', { ci: false, run: running, session: sess('working'), review: ago(3) }, { chip: 'Waiting for review', sentence: 'Review requested 3 min ago.' }],
    ['plan step report', { ci: false, run: running, session: sess('working', { lastSeenAt: ago(0) }), step: { n: 3, m: 5, at: ago(2) } }, { chip: 'Working', sentence: 'Working on plan step 3 of 5. Last report 2 min ago.' }],
    ['no report', { ci: false, run: running, session: sess('working') }, { chip: 'Working', sentence: 'Working. Started 3 min ago.' }],
  ]
  it.each(table)('%s', (_n, row, want) => {
    const live = ticketLive(row, now)!
    expect(live).toMatchObject(want)
    if (row.session?.health === 'stuck' || row.session?.health === 'disconnected') expect(live.chip).not.toBe('Working')
  })
  it('a stale session without a running Run says nothing', () => expect(ticketLive({ ci: false, run: { status: 'queued' }, session: sess('stuck') }, now)).toBeNull())
  it('a Step names "plan step n of m" or none', () => {
    expect(stepOf('Finished plan step 2 of 4: schema', 'T')).toEqual({ n: 2, m: 4, at: 'T' })
    expect(stepOf('Added the migration', 'T')).toBeNull()
    expect(stepOf(undefined, undefined)).toBeNull()
  })
})
