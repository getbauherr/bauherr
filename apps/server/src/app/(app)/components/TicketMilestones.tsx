'use client'

import { useEffect, useState } from 'react'
import type { Milestone } from '../lib/ticket-live'

/** New Run milestones of the Ticket as they happen (`/api/tickets/<id>/events`), appended without a page refresh; not announced per row. On a stream error it closes and the page's live poll takes over. */
export function TicketMilestones({ ticket }: { ticket: number }) {
  const [rows, setRows] = useState<(Milestone & { key: string })[]>([])
  useEffect(() => {
    const es = new EventSource(`/api/tickets/${ticket}/events`)
    es.addEventListener('milestone', (e) => setRows((r) => [...r, { ...(JSON.parse(e.data) as Milestone), key: e.lastEventId }].slice(-20)))
    es.addEventListener('error', () => es.close())
    return () => es.close()
  }, [ticket])
  return (
    <div role="log" aria-live="off" aria-label="Milestones" data-testid="ticket-milestones">
    <ol className="small m-0 flex list-none flex-col gap-1 p-0">
      {rows.map((r) => <li key={r.key}><span className="mono text-muted-foreground">{new Date(r.at).toLocaleTimeString()}</span> {r.text}</li>)}
    </ol>
    </div>
  )
}
