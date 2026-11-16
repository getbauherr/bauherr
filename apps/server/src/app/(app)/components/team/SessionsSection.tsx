'use client'
import { useState, type ReactNode } from 'react'
import { Switch } from '../ui/switch'

/** The Sessions list: `rows` are always shown, `disconnected` only behind the toggle (its state survives the 5 s refresh). */
export function SessionsSection({ rows, disconnected, count }: { rows: ReactNode[]; disconnected: ReactNode[]; count: number }) {
  const [show, setShow] = useState(false)
  const shown = rows.length > 0 || (show && disconnected.length > 0)
  return (
    <section aria-labelledby="sessions-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sessions-heading" className="heading">Sessions</h2>
        {count > 0 && (
          <label className="small flex items-center gap-2">
            <Switch checked={show} onChange={(e) => setShow(e.target.checked)} />
            {show ? 'Hide disconnected' : `Show ${count} disconnected`}
          </label>
        )}
      </div>
      {shown ? (
        <ul className="m-0 list-none rounded-md border border-border bg-card p-0" data-testid="sessions-list">{rows}{show && disconnected}</ul>
      ) : (
        <p className="small m-0 text-muted-foreground" data-testid="sessions-empty">{count ? 'All sessions are disconnected.' : 'No session connected. Copy the prompt, then paste it into a new Claude Code session.'}</p>
      )}
    </section>
  )
}
