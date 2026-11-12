'use client'
import { useState } from 'react'
import { reportProblem } from '../lib/actions'
import { Button } from './ui/button'
import { request } from './chat/dock-state'

/** "Report a problem" on a released request: starts a new Bug draft linked to it and opens the dock on it. */
export function ReportProblem({ session, size, variant = 'outline' }: { session: number; size?: 'sm'; variant?: 'outline' | 'default' }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <span className="inline-flex flex-col gap-1 self-start">
      <Button type="button" size={size} variant={variant} disabled={busy} data-testid="report-problem" onClick={async () => {
        setBusy(true)
        const r = await reportProblem(session)
        setBusy(false)
        if ('error' in r) return setError(r.error)
        request({ request: r.session })
      }}>Report a problem</Button>
      {error && <span role="alert" className="small text-destructive">{error}</span>}
    </span>
  )
}
