'use client'
import { useState } from 'react'
import { CommentComposer } from './CommentComposer'

/** Comment box of the Request page: with several Tickets a select picks which one the comment goes to. */
export function RequestComposer({ tickets, maxBytes, maxImages }: { tickets: { id: number; number: number; title: string }[]; maxBytes: number; maxImages: number }) {
  const [ticket, setTicket] = useState(tickets[0]!.id)
  return (
    <div className="flex flex-col gap-2">
      {tickets.length > 1 && (
        <label className="small flex items-center gap-2">
          Comment on
          <select className="rounded-md border border-border bg-card px-2 py-1" value={ticket} onChange={(e) => setTicket(Number(e.target.value))}>
            {tickets.map((t) => <option key={t.id} value={t.id}>#{t.number} {t.title}</option>)}
          </select>
        </label>
      )}
      <CommentComposer key={ticket} ticket={ticket} maxBytes={maxBytes} maxImages={maxImages} />
    </div>
  )
}
