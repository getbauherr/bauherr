import type { TicketRow } from './rows'
import { statusOf, type TicketStatus } from './status'

export const REQUEST_BUCKETS = ['open', 'live', 'closed'] as const
export type RequestBucket = (typeof REQUEST_BUCKETS)[number]

export type RequestMark = '!' | '·' | '◐' | '✓' | '×'
export type RequestTone = 'neutral' | 'accent' | 'ok' | 'warn'
export type RequestStatus = { word: string; tone: RequestTone; mark: RequestMark; bucket: RequestBucket }

type Input = Pick<
  TicketRow,
  'stage' | 'waitingOn' | 'card' | 'parked' | 'ended' | 'closedAs' | 'run' | 'questionDrafted'
>

const CLOSE_REASONS: Record<string, string> = {
  'not-a-bug': 'not a bug',
  duplicate: 'duplicate',
  'not-planned': 'not planned',
  discarded: 'discarded',
  'closed-on-forge': 'closed in the issue tracker',
  archived: 'archived',
  answered: 'answered',
}

const open = (word: string, tone: RequestTone, mark: RequestMark): RequestStatus => ({
  word,
  tone,
  mark,
  bucket: 'open',
})

const OPEN_STATUS: Partial<Record<TicketStatus, RequestStatus>> = {
  'reporter-asked': open('Waiting for you', 'warn', '!'),
  'brief-needs-approval': open('Plan waiting for approval', 'neutral', '·'),
  'result-ready': open('Ready to try', 'ok', '✓'),
  triaging: open('Received', 'neutral', '·'),
  'question-drafted': open('Received', 'neutral', '·'),
}

const closedStatus = (row: Input): RequestStatus => {
  const reason = row.closedAs === null ? undefined : CLOSE_REASONS[row.closedAs]
  return { word: reason ? `Closed: ${reason}` : 'Closed', tone: 'neutral', mark: '×', bucket: 'closed' }
}

export const requestStatus = (row: Input): RequestStatus => {
  if (row.ended === 'accepted') return { word: 'Live', tone: 'ok', mark: '✓', bucket: 'live' }
  if (row.ended === 'closed') return closedStatus(row)
  const status = statusOf({
    ...row,
    hasRun: row.run !== null,
    reviewer: row.run?.role === 'reviewer',
    claimed: row.run?.leasedBy != null,
  })
  if (status === 'queued' && row.stage === 'intake') return open('Received', 'neutral', '·')
  return OPEN_STATUS[status] ?? open('In progress', 'accent', '◐')
}

export const REQUEST_FILTERS = [...REQUEST_BUCKETS, 'mine'] as const
export type RequestFilter = (typeof REQUEST_FILTERS)[number]

export type RequestListRow = { row: TicketRow; status: RequestStatus; mine: boolean }

export const listRequests = (rows: TicketRow[], email: string): RequestListRow[] =>
  rows
    .map((row) => ({
      row,
      status: requestStatus(row),
      mine: row.reporter.toLowerCase() === email.toLowerCase(),
    }))
    .sort((a, b) => +b.row.changedAt - +a.row.changedAt)

export const filterCounts = (list: RequestListRow[]): Record<RequestFilter, number> => ({
  open: list.filter((r) => r.status.bucket === 'open').length,
  live: list.filter((r) => r.status.bucket === 'live').length,
  closed: list.filter((r) => r.status.bucket === 'closed').length,
  mine: list.filter((r) => r.mine).length,
})

export const applyFilter = (list: RequestListRow[], filter: RequestFilter): RequestListRow[] =>
  list.filter((r) => (filter === 'mine' ? r.mine : r.status.bucket === filter))
