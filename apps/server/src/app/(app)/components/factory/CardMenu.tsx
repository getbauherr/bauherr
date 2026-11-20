'use client'
import { Ellipsis } from '../icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'

const TRIGGER =
  'absolute top-1.5 right-1 z-10 grid size-7 place-items-center rounded-md border border-transparent ' +
  'text-muted-foreground opacity-0 outline-none hover:bg-secondary focus-visible:opacity-100 ' +
  'focus-visible:ring-2 focus-visible:ring-ring group-focus-within/card:opacity-100 ' +
  'group-hover/card:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100'

export type MoveTo = 'top' | 'up' | 'down'

type Props = { label: string; first: boolean; last: boolean; onMove: (to: MoveTo) => void }

export function CardMenu({ label, first, last, onMove }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={TRIGGER} aria-label={`Move ${label}`}>
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={first} onSelect={() => onMove('top')}>Move to top</DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove('up')}>Move up</DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove('down')}>Move down</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
