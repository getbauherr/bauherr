'use client'
import { useState, useTransition } from 'react'
import { archiveTicket, restoreTicket } from '../../(shell)/tickets/archive-actions'
import type { TicketView } from '../../../../core/views/ticket'
import type { TicketRelations } from '../../../../core/views/ticket-relations'
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

type OpenParts = { number: number; title: string }[]

function Archive({ recordId, number, openParts }: { recordId: number; number: number; openParts: OpenParts }) {
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
        {openParts.length > 0 && (
          <div className="small grid gap-1">
            <p className="m-0 font-medium">Parts still open</p>
            <ul className="m-0 grid list-none gap-0.5 p-0">
              {openParts.map((part) => (
                <li key={part.number}>
                  <span className="mono">#{part.number}</span> {part.title}
                </li>
              ))}
            </ul>
          </div>
        )}
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

type ControlProps = { view: TicketView; may: boolean; relations: TicketRelations | null }

export function ArchiveControl({ view, may, relations }: ControlProps) {
  if (view.restorable) {
    return (
      <Card>
        <p>
          {view.archived
            ? 'Archived. The ticket is out of the lists and its issue is closed on the forge.'
            : 'Closed on the forge. The ticket is out of the lists; restoring reopens its issue.'}
        </p>
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
      <Archive
        recordId={view.recordId}
        number={view.number}
        openParts={relations?.parts.tickets.filter((part) => !part.finished) ?? []}
      />
    </div>
  )
}
