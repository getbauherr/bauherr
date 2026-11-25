'use client'
import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export const DROP_PREFIX = 'drop:'

type Props = { index: number; name: string; removable: boolean; children: ReactNode }

export function RelationRow({ index, name, removable, children }: Props) {
  const [removed, setRemoved] = useState(false)
  if (removed) return <input type="hidden" name={`${DROP_PREFIX}${index}`} value="1" />
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 flex-1">{children}</span>
      {removable && (
        <button
          type="button"
          aria-label={`Remove: ${name}`}
          className="cursor-pointer rounded-sm p-1 text-muted-foreground hover:text-foreground"
          onClick={() => setRemoved(true)}
        >
          <X aria-hidden className="size-4" />
        </button>
      )}
    </li>
  )
}
