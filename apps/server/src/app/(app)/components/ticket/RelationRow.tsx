'use client'
import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Input } from '../ui/input'
import { Button } from '../ui/button'

export const DROP_PREFIX = 'drop:'

type Props = { index: number; name: string; removable: boolean; children: ReactNode }

export function RelationRow({ index, name, removable, children }: Props) {
  const [removed, setRemoved] = useState(false)
  if (removed) return <Input type="hidden" name={`${DROP_PREFIX}${index}`} value="1" />
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      {removable && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove: ${name}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setRemoved(true)}
        >
          <X aria-hidden className="size-4" />
        </Button>
      )}
    </li>
  )
}
