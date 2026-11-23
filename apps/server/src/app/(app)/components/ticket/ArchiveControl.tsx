'use client'
import { useState, useTransition } from 'react'
import { archiveTicket, restoreTicket } from '../../(shell)/tickets/archive-actions'
import type { TicketView } from '../../../../core/views/ticket'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog'
import { Card } from './Section'

function Restore({ recordId }: { recordId: number }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const press = () =>
    start(async () => {
      const result = await restoreTicket({ recordId })
      setError(result.error ?? null)
    })
  return (
    <>
      <Button type="button" disabled={pending} onClick={press}>
        Restore
      </Button>
      {error && <span role="alert" className="small text-destructive">{error}</span>}
    </>
  )
}

function Archive({ recordId, number }: { recordId: number; number: number }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const press = () =>
    start(async () => {
      const result = await archiveTicket({ recordId })
      setError(result.error ?? null)
      if (!result.error) setOpen(false)
    })
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="text-destructive">
          Archive
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive #{number}?</DialogTitle>
          <DialogDescription>
            The ticket leaves the Inbox and the Factory and its run is released. The issue is closed as not planned
            on the forge. Restore it later from this page.
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="small text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Keep ticket
          </Button>
          <Button type="button" variant="outline" className="text-destructive" disabled={pending} onClick={press}>
            Archive ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ArchiveControl({ view, may }: { view: TicketView; may: boolean }) {
  if (view.archived) {
    return (
      <Card>
        <p>Archived. The ticket is out of the lists and its issue is closed on the forge.</p>
        {may && (
          <div className="flex flex-wrap items-center gap-3">
            <Restore recordId={view.recordId} />
          </div>
        )}
      </Card>
    )
  }
  if (!may || !view.canArchive) return null
  return (
    <div className="flex justify-end">
      <Archive recordId={view.recordId} number={view.number} />
    </div>
  )
}
