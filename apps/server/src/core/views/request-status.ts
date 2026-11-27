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
  'brief-needs-approval': open('Plan waiting for approval', 'neutral', '·'),
  'result-ready': open('Ready to try', 'ok', '✓'),
  triaging: open('Received', 'neutral', '·'),
  'question-drafted': open('Received', 'neutral', '·'),
}

const closedStatus = (row: Input): RequestStatus => {
  const reason = row.closedAs === null ? undefined : CLOSE_REASONS[row.closedAs]
  return { word: reason ? `Closed: ${reason}` : 'Closed', tone: 'neutral', mark: '×', bucket: 'closed' }
}

const openStatus = (row: Input, mine: boolean): RequestStatus => {
  const status = statusOf({
    ...row,
    hasRun: row.run !== null,
    reviewer: row.run?.role === 'reviewer',
    claimed: row.run?.leasedBy != null,
  })
  if (status === 'queued' && row.stage === 'intake') return open('Received', 'neutral', '·')
  if (status === 'reporter-asked') return open(mine ? 'Waiting for you' : 'Waiting for the requester', 'warn', '!')
  return OPEN_STATUS[status] ?? open('In progress', 'accent', '◐')
}

export const requestStatus = (row: Input, mine: boolean): RequestStatus => {
  if (row.ended === 'accepted') return { word: 'Live', tone: 'ok', mark: '✓', bucket: 'live' }
  if (row.ended === 'closed') return closedStatus(row)
  return openStatus(row, mine)
}

export const REQUEST_FILTERS = [...REQUEST_BUCKETS, 'mine'] as const
export type RequestFilter = (typeof REQUEST_FILTERS)[number]

export type RequestListRow = { row: TicketRow; status: RequestStatus; mine: boolean }

export type Viewer = { forgeLogins: string[]; sentRecordIds: number[] }

export const listRequests = (rows: TicketRow[], viewer: Viewer): RequestListRow[] =>
  rows
    .map((row) => {
      const mine =
        viewer.forgeLogins.includes(row.reporter.toLowerCase()) || viewer.sentRecordIds.includes(row.recordId)
      return { row, status: requestStatus(row, mine), mine }
    })
    .sort((a, b) => +b.row.changedAt - +a.row.changedAt)
