'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { discardIntake } from '../lib/actions'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'

/** "Discard" of a draft (Requests list, Request page): asks in a dialog first, then removes the draft with its conversation and goes to the Requests list. */
export function DiscardDraft({ session, title, label = 'Discard draft' }: { session: number; title: string; label?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const discard = async () => {
    setBusy(true)
    setError('')
    try {
      await discardIntake(session)
      router.push('/requests')
    } catch {
      setError('Could not discard the draft. Please try again.')
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button type="button" variant="outline" aria-label={`Discard draft: ${title}`}>{label}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard this draft?</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-destructive" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Keep draft</Button>
          <Button type="button" variant="destructive" disabled={busy} onClick={() => void discard()}>Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
