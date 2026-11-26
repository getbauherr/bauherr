'use client'
import { Ellipsis } from 'lucide-react'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { useCardControls } from './card-controls'

export function CardMenu() {
  const controls = useCardControls()
  if (!controls) return null
  const { label, first, last, onMove } = controls
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${label}`}
          className="relative z-10 -mr-1.5 shrink-0 text-muted-foreground"
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={first} onSelect={() => onMove('top')}>Move to top</DropdownMenuItem>
        <DropdownMenuItem disabled={first} onSelect={() => onMove('up')}>Move up</DropdownMenuItem>
        <DropdownMenuItem disabled={last} onSelect={() => onMove('down')}>Move down</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
