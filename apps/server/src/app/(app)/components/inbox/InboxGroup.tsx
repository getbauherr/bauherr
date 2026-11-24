import { GROUP_TITLES, type GroupId, type InboxRow as Row } from '../../lib/inbox'
import { InboxRow, rowKeyOf } from './InboxRow'

export function InboxGroup({ id, rows }: { id: GroupId; rows: Row[] }) {
  return (
    <section id={id} aria-labelledby={`group-${id}`} className="scroll-mt-20 rounded-md border border-border bg-card">
      <header className="flex items-baseline gap-2 rounded-t-md bg-secondary px-4 py-3">
        <h2 id={`group-${id}`} className="heading">{GROUP_TITLES[id]}</h2>
        {id === 'done' ? (
          <span className="small text-muted-foreground">last 7 days</span>
        ) : (
          <span className="mono text-muted-foreground">{rows.length}</span>
        )}
      </header>
      {rows.length ? (
        <ul className="m-0 list-none p-0">
          {rows.map((row) => <li key={rowKeyOf(row)}><InboxRow row={row} /></li>)}
        </ul>
      ) : (
        <p className="small px-4 py-3 text-muted-foreground">Nothing here.</p>
      )}
    </section>
  )
}
