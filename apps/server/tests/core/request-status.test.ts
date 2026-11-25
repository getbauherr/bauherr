import { describe, expect, it } from 'vitest'
import { applyFilter, filterCounts, listRequests, requestStatus } from '../../src/core/views/request-status'
import type { TicketRow } from '../../src/core/views/rows'

type Input = Parameters<typeof requestStatus>[0]

const base: Input = {
  stage: 'build',
  waitingOn: 'agents',
  card: null,
  parked: null,
  ended: null,
  closedAs: null,
  run: { role: 'builder', leasedBy: 'worker', step: null },
  questionDrafted: false,
}
const card = (kind: 'brief' | 'result' | 'question', reason = 'r') => ({ card: kind, reason, options: [], seq: 1 })
const word = (patch: Partial<Input>) => requestStatus({ ...base, ...patch }).word

describe('the status words of a request', () => {
  it.each<[string, Partial<Input>, string]>([
    ['intake, being read', { stage: 'intake' }, 'Received'],
    ['intake, queued', { stage: 'intake', run: { role: 'builder', leasedBy: null, step: null } }, 'Received'],
    [
      'intake, drafting a question',
      { stage: 'intake', waitingOn: 'reporter', run: null, questionDrafted: true },
      'Received',
    ],
    ['intake, asked the reporter', { stage: 'intake', waitingOn: 'reporter', run: null }, 'Waiting for you'],
    ['brief, being written', { stage: 'brief' }, 'In progress'],
    [
      'brief, waiting',
      { stage: 'brief', waitingOn: 'owner', card: card('brief'), run: null },
      'Plan waiting for approval',
    ],
    ['build', { stage: 'build' }, 'In progress'],
    ['build, queued', { stage: 'build', run: { role: 'builder', leasedBy: null, step: null } }, 'In progress'],
    ['verify, reviewing', { stage: 'verify', run: { role: 'reviewer', leasedBy: 'w', step: null } }, 'In progress'],
    ['verify, waiting for checks', { stage: 'verify', run: null }, 'In progress'],
    ['ship, waiting for deploy', { stage: 'ship', run: null }, 'In progress'],
    ['result card', { stage: 'verify', waitingOn: 'owner', card: card('result'), run: null }, 'Ready to try'],
    [
      'stuck, with the Bauherr',
      { waitingOn: 'owner', card: card('question', 'failed-runs'), run: null },
      'In progress',
    ],
    ['waiting on the author', { waitingOn: 'author', run: null }, 'In progress'],
    ['parked', { parked: 'limit reached', waitingOn: 'nobody', run: null }, 'In progress'],
    ['accepted', { stage: 'done', ended: 'accepted', run: null }, 'Live'],
    ['closed without a reason', { stage: 'done', ended: 'closed', run: null }, 'Closed'],
  ])('%s reads %s', (_name, patch, expected) => {
    expect(word(patch)).toBe(expected)
  })

  it.each([
    ['not-a-bug', 'Closed: not a bug'],
    ['duplicate', 'Closed: duplicate'],
    ['not-planned', 'Closed: not planned'],
    ['discarded', 'Closed: discarded'],
    ['closed-on-forge', 'Closed: closed in the issue tracker'],
    ['archived', 'Closed: archived'],
  ] as const)('a request closed as %s reads %s', (closedAs, expected) => {
    expect(word({ stage: 'done', ended: 'closed', closedAs, run: null })).toBe(expected)
  })

  it('puts each status into one bucket', () => {
    expect(requestStatus({ ...base, ended: 'accepted' }).bucket).toBe('live')
    expect(requestStatus({ ...base, ended: 'closed' }).bucket).toBe('closed')
    expect(requestStatus(base).bucket).toBe('open')
  })
})

describe('the filters of the Requests page', () => {
  const row = (n: number, patch: Partial<TicketRow>): TicketRow =>
    ({
      ...base,
      recordId: n,
      reporter: 'someone',
      changedAt: new Date(2026, 10, n),
      ...patch,
    }) as TicketRow

  const rows = [
    row(1, { reporter: 'Me@Example.com' }),
    row(2, { ended: 'accepted', stage: 'done', run: null }),
    row(3, { ended: 'closed', stage: 'done', run: null, reporter: 'me@example.com' }),
  ]

  it('counts and filters Open, Live, Closed and Only mine, newest change first', () => {
    const list = listRequests(rows, 'me@example.com')
    expect(list.map((r) => r.row.recordId)).toEqual([3, 2, 1])
    expect(filterCounts(list)).toEqual({ open: 1, live: 1, closed: 1, mine: 2 })
    expect(applyFilter(list, 'live').map((r) => r.row.recordId)).toEqual([2])
    expect(applyFilter(list, 'mine').map((r) => r.row.recordId)).toEqual([3, 1])
  })
})
