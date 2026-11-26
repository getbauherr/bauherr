import type { ReactNode } from 'react'
import { CheckIcon, Loader2Icon, MinusIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TodoStatus = 'pending' | 'active' | 'done' | 'failed' | 'cancelled'

export interface TodoItem {
  id: string
  text: string
  status: TodoStatus
  description?: string | undefined
  reason?: string | undefined
}

const statusIcon: Record<TodoStatus, ReactNode> = {
  done: (
    <span
      className={cn(
        'border-foreground/20 bg-foreground/[0.06] flex size-3.5 items-center',
        'justify-center rounded-[5px] border',
      )}
    >
      <CheckIcon className="text-muted-foreground size-2.5" />
    </span>
  ),
  failed: (
    <span
      className={cn(
        'flex size-3.5 items-center justify-center rounded-[5px] border border-danger/25',
        'bg-danger/[0.08]',
      )}
    >
      <XIcon className="size-2.5 text-danger " />
    </span>
  ),
  cancelled: (
    <span
      className={cn(
        'border-foreground/15 text-muted-foreground flex size-3.5 items-center',
        'justify-center rounded-[5px] border',
      )}
    >
      <MinusIcon className="size-2.5" />
    </span>
  ),
  active: <Loader2Icon className={cn('size-3.5 animate-spin text-primary motion-reduce:animate-none', ' ')} />,
  pending: <span className="border-foreground/15 size-3.5 rounded-[5px] border" />,
}

const textClass: Record<TodoStatus, string> = {
  done: 'text-muted-foreground line-through decoration-[1.5px]',
  active: 'text-foreground/90',
  pending: 'text-muted-foreground',
  failed: 'text-danger ',
  cancelled: 'text-muted-foreground line-through decoration-[1.5px]',
}

const rowClassName = cn(
  'fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex items-start',
  'gap-2.5 py-0.5 text-[13.5px] duration-300 motion-reduce:animate-none',
)

export const isFoldable = (item: TodoItem, index: number, visibleCount: number) =>
  index >= visibleCount && item.status !== 'active' && item.status !== 'failed'

function itemNote(item: TodoItem) {
  if (item.status === 'failed') {
    return item.reason
  }
  return item.status !== 'cancelled' ? item.description : undefined
}

export function TodoRow({ item }: { item: TodoItem }) {
  const note = itemNote(item)
  return (
    <li data-status={item.status} className={rowClassName}>
      <span aria-hidden className="flex size-4 h-5 shrink-0 items-center justify-center">
        {statusIcon[item.status]}
      </span>
      <span className="sr-only">{item.status}</span>
      <div className="min-w-0 flex-1 leading-5 break-words">
        <span className={textClass[item.status]}>{item.text}</span>
        {note ? <p className="text-muted-foreground text-xs leading-4 break-words">{note}</p> : null}
      </div>
    </li>
  )
}
