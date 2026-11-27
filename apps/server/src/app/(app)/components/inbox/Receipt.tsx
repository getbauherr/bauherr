'use client'
import { CheckIcon } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { ticketPath } from '../../lib/inbox-entries'
import { paper } from '../assistant-ui/elements/surfaces'
import { Button } from '../ui/button'
import type { Staged } from './use-pending-decisions'

type Props = { staged: Staged | undefined; recordId: number; number: number; onUndo: () => void }

export function Receipt({ staged, recordId, number, onUndo }: Props) {
  return (
    <div role="status" className={cn(paper, 'flex w-full max-w-lg items-center gap-3 rounded-[20px] p-4')}>
      <CheckIcon className="text-ok size-4 shrink-0" aria-hidden />
      <p className="small m-0 min-w-0 flex-1">
        <span className="font-medium">{staged?.receipt}</span>
        <span className="text-muted-foreground"> on </span>
        <Link href={ticketPath(recordId)} className="mono hover:underline">#{number}</Link>
      </p>
      <Button variant="ghost" size="sm" onClick={onUndo}>
        Undo
      </Button>
    </div>
  )
}
