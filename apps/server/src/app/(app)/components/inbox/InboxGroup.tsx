import type { InboxCursor } from '../../../../core/views/inbox'
import { GROUP_TITLES, INBOX_PAGE, type GroupId, type InboxRow as Row } from '../../lib/inbox'
import { InboxMore } from './InboxMore'
import { InboxRow, rowKeyOf } from './InboxRow'

type Props = { id: GroupId; rows: Row[]; total: number; cursor: InboxCursor | null }

export function InboxGroup({ id, rows, total, cursor }: Props) {
  const shown = rows.filter((row) => row.kind === 'ticket').length
  const paged = id !== 'you' && cursor !== null && shown >= INBOX_PAGE
  return (
    <section id={id} aria-labelledby={`group-${id}`} className="scroll-mt-20 rounded-md border border-border bg-card">
      <header className="flex items-baseline gap-2 rounded-t-md bg-secondary px-4 py-3">
        <h2 id={`group-${id}`} className="heading">{GROUP_TITLES[id]}</h2>
        <span className="mono text-muted-foreground">{total}</span>
        {id === 'done' && <span className="small text-muted-foreground">last 7 days</span>}
      </header>
      {rows.length ? (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => <li key={rowKeyOf(row)}><InboxRow row={row} /></li>)}
        </ul>
      ) : (
        <p className="small px-4 py-3 text-muted-foreground">Nothing here.</p>
      )}
      {paged && (
        <InboxMore
          group={id}
          cursor={cursor}
          remaining={total - rows.length}
        />
      )}
    </section>
  )
}
