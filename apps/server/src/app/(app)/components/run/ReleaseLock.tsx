'use client'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'

const Confirm = () => {
  const { pending } = useFormStatus()
  return <Button type="submit" disabled={pending}>Release lock</Button>
}

/** Admin only, secondary: the page renders it for a stuck or gone session. `action` is `releaseRunLock` bound to the Run. */
export function ReleaseLock({ runId, why, action }: { runId: number; why: string; action: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" data-testid="release-lock">Release lock</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Release the lock on Run {runId}?</DialogTitle>
          <DialogDescription>{why} The Run goes back to the queue.</DialogDescription>
        </DialogHeader>
        <form action={action}>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Confirm />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
