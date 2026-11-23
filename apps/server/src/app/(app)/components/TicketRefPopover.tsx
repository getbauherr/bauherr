'use client'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from './ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

const CLOSE_DELAY_MS = 120

export type PopoverTicket = { recordId: number; number: number; title: string; stage: string }

type Props = { ticket: PopoverTicket; label: string; className?: string }

export function TicketRefPopover({ ticket, label, className }: Props) {
  const [open, setOpen] = useState(false)
  const focusInto = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const show = () => {
    clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }
  const choose = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    focusInto.current = true
    show()
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Link
          href={`/tickets/${ticket.recordId}`}
          draggable={false}
          className={cn('text-primary underline underline-offset-2', className)}
          onClick={choose}
          onKeyDown={(event) => event.key === ' ' && choose(event)}
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {label}
        </Link>
      </PopoverTrigger>
      <PopoverContent
        onMouseEnter={show}
        onMouseLeave={hide}
        onOpenAutoFocus={(event) => {
          if (!focusInto.current) event.preventDefault()
          focusInto.current = false
        }}
      >
        <p className="m-0 font-semibold">{ticket.title}</p>
        <p className="small m-0 mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="mono text-foreground">#{ticket.number}</span>
          <Badge>{ticket.stage}</Badge>
          <span>in stage</span>
        </p>
        <Link href={`/tickets/${ticket.recordId}`} className="mt-3 inline-block text-primary underline">
          Open ticket
        </Link>
      </PopoverContent>
    </Popover>
  )
}
