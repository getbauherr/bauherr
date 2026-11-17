'use client'
import { useState } from 'react'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog'
import type { SaveResult } from './types'

type Props = { label: string; title: string; text: string; confirm: string; onConfirm: () => Promise<SaveResult> | SaveResult; testId: string }

function Confirm({ label, title, text, confirm, onConfirm, testId }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    setBusy(true)
    setError('')
    const res = await Promise.resolve(onConfirm()).catch(() => ({ error: 'That did not go through. Try again.' }))
    setBusy(false)
    if (res?.error) return setError(res.error)
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError('') }}>
      <DialogTrigger asChild><Button type="button" variant="outline" data-testid={testId}>{label}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{text}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={() => void submit()} data-testid={`${testId}-confirm`}>{confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Admin only: the page renders this for an Admin and never otherwise. */
export function AgentActions({ name, disconnect, release }: { name: string; disconnect?: () => Promise<SaveResult>; release?: () => Promise<SaveResult> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {release && <Confirm testId="release-lock" label="Release lock" title="Release the lock" text={`${name} holds a running Run and is not answering. Releasing ends the Run as abandoned and queues the next one.`} confirm="Release lock" onConfirm={release} />}
      {disconnect && <Confirm testId="disconnect" label="Disconnect" title="Disconnect this agent" text={`${name} is ended and its running Run goes back to the queue.`} confirm="Disconnect" onConfirm={disconnect} />}
    </div>
  )
}
