import { describe, expect, it } from 'vitest'
import { ticketStatus, type StatusRow, type StatusRun } from '../src/app/(app)/lib/status'
import { DEFAULT } from '../src/lib/workflow'

const wf = DEFAULT()
const now = +new Date('2026-01-01T01:00:00Z')
const run = (over: Partial<StatusRun> = {}): StatusRun => ({ stage: 'build', status: 'running', mode: 'autonomous', createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:55:00Z', ...over })
const row = (over: Partial<StatusRow> = {}): StatusRow => ({ open: true, stage: 'build', needsYou: null, blockedBy: [], queuedWhy: null, run: null, owner: null, forge: 'github', gate: null, track: {}, ...over })
const at = (r: StatusRow) => ticketStatus(wf, r, now)

describe('ticketStatus', () => {
  const table: [string, StatusRow, { phase: string; label: string; detail: string | null; who: string | null }][] = [
    ['closed', row({ open: false }), { phase: 'done', label: 'Done', detail: null, who: null }],
    ['runner Run', row({ run: run({ model: 'sonnet' }) }), { phase: 'working', label: 'In progress', detail: 'building for 5 min', who: 'Bauherr runner · sonnet' }],
    ['session Run with label, client, model', row({ run: run({ mode: 'session', sessionLabel: 'ada-laptop', clientName: 'claude-code', clientVersion: '2.1', model: 'opus' }), owner: 'ada' }), { phase: 'working', label: 'In progress', detail: 'building for 5 min', who: 'ada-laptop · claude-code 2.1 · opus' }],
    ['session Run without metadata falls back to the owner', row({ run: run({ mode: 'session' }), owner: 'ada' }), { phase: 'working', label: 'In progress', detail: 'building for 5 min', who: 'ada' }],
    ['session executor without owner', row({ run: run({ executor: 'session' }) }), { phase: 'working', label: 'In progress', detail: 'building for 5 min', who: 'Session' }],
    ['review Run names reviewing', row({ stage: 'review', run: run({ stage: 'review' }) }), { phase: 'working', label: 'In progress', detail: 'reviewing for 5 min', who: 'Bauherr runner' }],
    ['escalated Run', row({ run: run({ escalation: { step: 2, reason: 'stuck' } }) }), { phase: 'working', label: 'In progress', detail: 'building for 5 min · escalated to the strong model (step 2 of 4)', who: 'Bauherr runner' }],
    ['investigation Run', row({ stage: 'plan', run: run({ stage: 'plan', investigation: {} }) }), { phase: 'working', label: 'In progress', detail: 'planning for 5 min · investigating', who: 'Bauherr runner' }],
    ['Run waiting for a session', row({ run: run({ status: 'awaiting_session', mode: 'session' }) }), { phase: 'queued', label: 'Queued', detail: 'waiting for a session', who: null }],
    ['queued Run with a full column', row({ run: run({ status: 'queued' }), queuedWhy: 'Build is full (2/2)' }), { phase: 'queued', label: 'Queued', detail: 'Build is full (2/2)', who: null }],
    ['a Run of another stage is not the Ticket\'s work', row({ stage: 'review', run: run({ status: 'running' }) }), { phase: 'queued', label: 'Queued', detail: 'next in line', who: null }],
    ['checkpoint', row({ stage: 'plan', needsYou: 'Approve plan', gate: { people: ['ada', 'bob'] } }), { phase: 'human', label: 'Waiting for you', detail: 'Approve plan', who: '@ada @bob' }],
    ['failed Run that reached the owner', row({ needsYou: 'Run failed', run: run({ status: 'failed', error: 'tests red\nmore' }) }), { phase: 'human', label: 'Waiting for you', detail: 'Run failed: tests red', who: null }],
    ['checks on GitHub', row({ track: { waitingFor: 'checks' } }), { phase: 'ci', label: 'Waiting on CI', detail: 'checks of the merge request', who: 'GitHub Actions' }],
    ['checks on GitLab', row({ forge: 'gitlab', track: { waitingFor: 'checks' } }), { phase: 'ci', label: 'Waiting on CI', detail: 'checks of the merge request', who: 'GitLab CI' }],
    ['review waiting for checks', row({ stage: 'review', track: { reviewState: 'waiting_checks' } }), { phase: 'ci', label: 'Waiting on CI', detail: 'checks of the merge request', who: 'GitHub Actions' }],
    ['review in the merge queue', row({ stage: 'review', track: { reviewState: 'queued' } }), { phase: 'ci', label: 'Waiting on merge queue', detail: 'the merge request is in the merge queue', who: 'GitHub Actions' }],
    ['staging deploy', row({ stage: 'release', track: { releaseState: 'waiting' } }), { phase: 'ci', label: 'Waiting on deploy', detail: 'the staging deploy', who: 'GitHub Actions' }],
    ['production deploy', row({ stage: 'release', track: { productionState: 'deploying' } }), { phase: 'ci', label: 'Waiting on deploy', detail: 'the production deploy', who: 'GitHub Actions' }],
    ['release checks without a known forge', row({ stage: 'release', forge: null, track: { releaseChecksState: 'waiting' } }), { phase: 'ci', label: 'Waiting on CI', detail: 'the release checks', who: null }],
    ['blocked', row({ blockedBy: [{ number: 12 }, { number: 15 }] }), { phase: 'blocked', label: 'Blocked', detail: 'by #12, #15', who: null }],
    ['failed Run the factory retries', row({ run: run({ status: 'failed', error: 'boom\nstack' }) }), { phase: 'failed', label: 'Failed', detail: 'boom', who: null }],
    ['budget exhausted', row({ run: run({ status: 'budget_exhausted' }) }), { phase: 'failed', label: 'Failed', detail: 'budget exhausted', who: null }],
    ['waiting for a free slot', row({ queuedWhy: 'Build is full (2/2)' }), { phase: 'queued', label: 'Queued', detail: 'Build is full (2/2)', who: null }],
    ['idle', row(), { phase: 'queued', label: 'Queued', detail: 'next in line', who: null }],
  ]
  it.each(table)('%s', (_name, r, want) => {
    expect(at(r)).toMatchObject(want)
  })
  it('a checkpoint beats a blocker, a blocker beats a failed Run, and a live Run beats a checkpoint', () => {
    expect(at(row({ needsYou: 'Expedite?', blockedBy: [{ number: 1 }] })).phase).toBe('human')
    expect(at(row({ blockedBy: [{ number: 1 }], run: run({ status: 'failed' }) })).phase).toBe('blocked')
    expect(at(row({ needsYou: 'Needs you', run: run() })).phase).toBe('working')
  })
  it('never says Working', () => {
    for (const [, r] of table) expect(JSON.stringify(at(r))).not.toMatch(/Working/)
  })
})

describe('terminal and split stages', () => {
  it('an open Ticket in the done stage is Done and closing, never Queued', () => {
    expect(at(row({ stage: 'done' }))).toMatchObject({ phase: 'done', label: 'Done', detail: 'closing', who: null })
    expect(at(row({ stage: 'done', run: run({ stage: 'done' }), queuedWhy: 'x' }))).toMatchObject({ label: 'Done', detail: 'closing' })
  })
  it('a closed Ticket is always Done, whatever else its row says', () => {
    expect(at(row({ open: false, stage: 'done' }))).toMatchObject({ label: 'Done', detail: null })
    expect(at(row({ open: false, stage: 'build', needsYou: 'Run failed', blockedBy: [{ number: 1 }], run: run() }))).toMatchObject({ phase: 'done', label: 'Done' })
  })
  it('a split Ticket reads how far its sub-tickets are', () => {
    expect(at(row({ stage: 'parent', children: { total: 3, done: 1 } }))).toMatchObject({ label: 'Split', detail: 'into 3 sub-tickets (1 done)' })
    expect(at(row({ stage: 'parent', children: { total: 1, done: 0 } })).detail).toBe('into 1 sub-ticket (0 done)')
    expect(at(row({ stage: 'parent' })).detail).toBe('into 0 sub-tickets (0 done)')
  })
})
