import type { Payload } from 'payload'
import type { HeldItem } from '../../../../core/intake/held'
import type { InboxChunk, InboxGroupId } from '../../../../core/views/inbox'
import type { RowFilter } from '../../../../core/views/rows'
import { loadTotals } from '../../../../core/views/totals'
import { GROUPS, type InboxRow } from '../../lib/inbox'
import { Badge } from '../ui/badge'
import { InboxGroup } from './InboxGroup'
import { InboxKeys } from './InboxKeys'

const percent = (rate: number | null): string => (rate === null ? '—' : `${Math.round(rate * 100)}%`)

type Inbox = Promise<Record<InboxGroupId, InboxChunk>>

export async function WaitingBadge({ inbox }: { inbox: Inbox }) {
  const waiting = (await inbox).you.total
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

const heldRows = (items: HeldItem[]): InboxRow[] => items.map((item) => ({ kind: 'held', item, repo: item.repo }))

export async function InboxGroups({ inbox, held }: { inbox: Inbox; held: Promise<HeldItem[]> }) {
  const [chunks, heldItems] = await Promise.all([inbox, held])
  return (
    <InboxKeys>
      {GROUPS.map((id) => {
        const { cards, total, cursor } = chunks[id]
        const first = id === 'others' ? heldRows(heldItems) : []
        const rows = [...first, ...cards.map((card): InboxRow => ({ kind: 'ticket', card }))]
        return <InboxGroup key={id} id={id} rows={rows} total={total + first.length} cursor={cursor} />
      })}
    </InboxKeys>
  )
}
