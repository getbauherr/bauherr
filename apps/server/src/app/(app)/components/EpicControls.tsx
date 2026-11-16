'use client'
import { useState } from 'react'
import { epicAction } from '../lib/actions'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'

type Option = 'park' | 'resume' | 'discard'

const COPY: Record<Option, { trigger: string; title: string; text: string; confirm: string }> = {
  park: { trigger: 'Park epic', title: 'Park this epic?', text: 'Its live Runs are cancelled and nothing merges. The epic branch and PR stay, and it holds no WIP until you resume or discard it.', confirm: 'Park epic' },
  resume: { trigger: 'Resume epic', title: 'Resume this epic?', text: 'It continues where it stopped: the cancelled stage starts again.', confirm: 'Resume epic' },
  discard: { trigger: 'Discard epic…', title: 'Discard this epic?', text: 'The epic PR is closed without merging, the epic branch is deleted, and the epic and all its open slices are closed as not planned. This cannot be undone.', confirm: 'Discard epic' },
}

function Confirm({ ticket, option, variant = 'outline', danger }: { ticket: number; option: Option; variant?: 'default' | 'outline'; danger?: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const c = COPY[option]
  const submit = async () => {
    setBusy(true)
    setError('')
    const fd = new FormData()
    fd.set('ticket', String(ticket))
    fd.set('option', option)
    const res = await epicAction(fd).catch(() => ({ error: 'That did not go through. Try again.' }))
    setBusy(false)
    if (res.error) return setError(res.error)
    setOpen(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError('') }}>
      <DialogTrigger asChild><Button type="button" variant={variant} className={danger ? 'text-destructive' : undefined} data-testid={`epic-${option}`}>{c.trigger}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
          <DialogDescription>{c.text}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" variant={danger ? 'outline' : 'default'} className={danger ? 'text-destructive' : undefined} disabled={busy} onClick={() => void submit()} data-testid={`epic-${option}-confirm`}>{c.confirm}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Park / Resume / Discard of an epic parent (Bauherr or Admin; the Ticket page is theirs). Discard is offered only on a parked epic. */
export function EpicControls({ ticket, parked }: { ticket: number; parked: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="epic-controls">
      {parked ? (
        <>
          <Confirm ticket={ticket} option="resume" variant="default" />
          <Confirm ticket={ticket} option="discard" danger />
        </>
      ) : <Confirm ticket={ticket} option="park" />}
    </div>
  )
}
