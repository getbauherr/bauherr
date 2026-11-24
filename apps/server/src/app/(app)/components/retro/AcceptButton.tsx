'use client'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { acceptProposalAction } from '../../(shell)/memory/retro/actions'
import { Button } from '../ui/button'

export function AcceptButton({ retro, id, accepted }: { retro: number; id: string; accepted: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  if (accepted) return <span className="small text-ok">Accepted: goes into the outcome</span>
  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="alert" className="small text-destructive">
          {error}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await acceptProposalAction(retro, id)
            setError(result.error ?? null)
            router.refresh()
          })
        }
      >
        Accept
      </Button>
    </span>
  )
}
