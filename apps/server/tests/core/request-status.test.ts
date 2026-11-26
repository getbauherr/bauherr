import { describe, expect, it } from 'vitest'
import { listRequests, requestStatus } from '../../src/core/views/request-status'
import type { ClosedAs, TicketRow } from '../../src/core/views/rows'

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
const word = (patch: Partial<Input>, mine = true) => requestStatus({ ...base, ...patch }, mine).word

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

  const closedWords: Record<ClosedAs, string> = {
    answered: 'Closed: answered',
    'not-a-bug': 'Closed: not a bug',
    duplicate: 'Closed: duplicate',
    'not-planned': 'Closed: not planned',
    discarded: 'Closed: discarded',
    'closed-on-forge': 'Closed: closed in the issue tracker',
    archived: 'Closed: archived',
  }

  it.each(Object.entries(closedWords) as [ClosedAs, string][])(
    'a request closed as %s reads %s',
    (closedAs, expected) => {
      expect(word({ stage: 'done', ended: 'closed', closedAs, run: null })).toBe(expected)
    },
  )

  it('puts each status into one bucket', () => {
    expect(requestStatus({ ...base, ended: 'accepted' }, false).bucket).toBe('live')
    expect(requestStatus({ ...base, ended: 'closed' }, false).bucket).toBe('closed')
    expect(requestStatus(base, false).bucket).toBe('open')
  })
})

describe('who a waiting request waits for', () => {
  const waiting = { stage: 'intake', waitingOn: 'reporter', run: null } as const

  it('says Waiting for you only to the creator', () => {
    expect(word(waiting, true)).toBe('Waiting for you')
    expect(word(waiting, false)).toBe('Waiting for the requester')
  })

  it('lists the same request by viewer', () => {
    const rows = [{ ...base, ...waiting, recordId: 1, reporter: 'jo', changedAt: new Date() } as TicketRow]
    expect(listRequests(rows, { forgeLogins: ['jo'], sentRecordIds: [] })[0]?.status.word).toBe('Waiting for you')
    const other = listRequests(rows, { forgeLogins: ['other'], sentRecordIds: [] })
    expect(other[0]?.status.word).toBe('Waiting for the requester')
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
    row(1, { reporter: 'Me-Login' }),
    row(2, { ended: 'accepted', stage: 'done', run: null }),
    row(3, { ended: 'closed', stage: 'done', run: null, reporter: 'me-login' }),
  ]

  it('matches the creator on the forge login, not on a request by someone else', () => {
    const list = listRequests(rows, { forgeLogins: ['someone'], sentRecordIds: [] })
    expect(list.filter((r) => r.mine).map((r) => r.row.recordId)).toEqual([2])
    expect(listRequests(rows, { forgeLogins: [], sentRecordIds: [] }).some((r) => r.mine)).toBe(false)
  })

  it('counts a request the viewer sent through a conversation, whatever its forge author', () => {
    const list = listRequests(rows, { forgeLogins: [], sentRecordIds: [2] })
    expect(list.filter((r) => r.mine).map((r) => r.row.recordId)).toEqual([2])
  })

  it('lists the newest change first', () => {
    const list = listRequests(rows, { forgeLogins: ['me-login'], sentRecordIds: [] })
    expect(list.map((r) => r.row.recordId)).toEqual([3, 2, 1])
  })
})
