import type { Payload } from 'payload'
import type { Board } from '../../../../core/views/board'
import type { RowFilter } from '../../../../core/views/rows'
import { loadTotals } from '../../../../core/views/totals'
import { GROUPS, groupRows } from '../../lib/inbox'
import { Badge } from '../ui/badge'
import { InboxGroup } from './InboxGroup'
import { InboxKeys } from './InboxKeys'

const percent = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`)

export async function WaitingBadge({ lanes }: { lanes: Promise<Board> }) {
  const waiting = groupRows(await lanes).you.length
  return waiting > 0 ? <Badge variant="warn">Waiting for you {waiting}</Badge> : null
}

export async function InboxTotals({ payload, filter }: { payload: Payload; filter: RowFilter }) {
  const totals = await loadTotals(payload, filter)
  return (
    <p className="small ml-auto text-muted-foreground">
      Last 30 days: first-pass accept <span className="mono">{percent(totals.firstPassAcceptRate)}</span> ·
      exceptions <span className="mono">{percent(totals.exceptionRate)}</span>
    </p>
  )
}

export async function InboxGroups({ lanes }: { lanes: Promise<Board> }) {
  const rows = groupRows(await lanes)
  return <InboxKeys>{GROUPS.map((id) => <InboxGroup key={id} id={id} rows={rows[id]} />)}</InboxKeys>
}
