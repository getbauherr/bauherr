'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { reportProblem } from '../lib/actions'
import { Button } from './ui/button'

/** "Report a problem" on a released request: starts a new Bug draft linked to it and opens its conversation. */
export function ReportProblem({ session, size, variant = 'outline' }: { session: number; size?: 'sm'; variant?: 'outline' | 'default' }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <span className="inline-flex flex-col gap-1 self-start">
      <Button type="button" size={size} variant={variant} disabled={busy} data-testid="report-problem" onClick={async () => {
        setBusy(true)
        const r = await reportProblem(session)
        setBusy(false)
        if ('error' in r) return setError(r.error)
        router.push(`/requests/${r.session}`)
      }}>Report a problem</Button>
      {error && <span role="alert" className="small text-destructive">{error}</span>}
    </span>
  )
}
