'use client'

import { useId, useState, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { ghostButton, mono } from './surfaces'
import { clamp } from '../utils/range'
import { isFoldable, TodoRow, type TodoItem } from './todo-list.parts'

export type { TodoItem, TodoStatus } from './todo-list.parts'

export function TodoList({
  items,
  revision,
  title = 'Todos',
  description,
  maxVisible,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'children' | 'items' | 'revision' | 'title'> & {
  items: readonly TodoItem[]
  revision?: number | undefined
  title?: string | undefined
  description?: string | undefined
  maxVisible?: number | undefined
}) {
  const done = items.filter((item) => item.status === 'done').length
  const total = items.filter((item) => item.status !== 'cancelled').length
  const visibleCount = Math.floor(clamp(maxVisible ?? items.length, 0, items.length))
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const hiddenItems = items.filter((item, index) => isFoldable(item, index, visibleCount))
  const canFold = maxVisible !== undefined && hiddenItems.length > 0
  return (
    <div data-slot="todo-list" className={cn('flex w-full max-w-sm flex-col gap-3', className)} {...props}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[13.5px] font-medium">{title}</span>
          {description ? <p className="text-muted-foreground text-xs leading-4 break-words">{description}</p> : null}
        </div>
        <span className={cn(mono, 'text-muted-foreground shrink-0 whitespace-nowrap tabular-nums')}>
          {revision === undefined ? `${done}/${total}` : `${done}/${total} · rev ${revision}`}
        </span>
      </div>
      <ul id={listId} className="flex flex-col gap-1">
        {items.map((item, index) =>
          canFold && !expanded && isFoldable(item, index, visibleCount) ? null : <TodoRow key={item.id} item={item} />,
        )}
      </ul>
      {canFold ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((current) => !current)}
          className={cn(ghostButton, 'self-start px-2 py-1 text-xs font-medium')}
        >
          {expanded ? 'Show less' : `Show ${hiddenItems.length} more`}
        </button>
      ) : null}
    </div>
  )
}
