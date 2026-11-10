'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { rankFirstAction, rankTicketAction } from '../lib/actions'
import { cn } from '@/lib/utils'
import { CardMenu, longPress, type CardAction } from './CardMenu'
import { Card } from './ui/card'

const before = "before:pointer-events-none before:absolute before:inset-x-0 before:-top-2 before:h-0.5 before:rounded-[1px] before:bg-primary before:content-['']"
const after = "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-2 after:h-0.5 after:rounded-[1px] after:bg-primary after:content-['']"
const stripe = 'border-primary [background:linear-gradient(var(--accent),var(--accent))_left_top/3px_40%_no-repeat,var(--surface-000)] animate-stripe motion-reduce:animate-none motion-reduce:[background-size:3px_100%]'

type Item = { id: number; node: ReactNode; movable: boolean; running?: boolean; hotfix?: boolean }

const move = <T,>(xs: T[], from: number, to: number): T[] => {
  const out = [...xs]
  out.splice(to, 0, out.splice(from, 1)[0])
  return out
}

/** One Board column: cards sortable by drag and drop, Alt+ArrowUp/Down or the card menu; a move persists via `rankTicketAction`. The Hotfix lane sits above the ranked cards and is ranked on its own: neighbours are always those of the same lane. */
export function SortableCards({ items }: { items: Item[] }) {
  const router = useRouter()
  const [order, setOrder] = useState(items)
  const [drag, setDrag] = useState<number | null>(null)
  const [target, setTarget] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [menu, setMenu] = useState<number | null>(null)
  useEffect(() => setOrder(items), [items])

  const reorder = async (from: number, to: number) => {
    if (from === to) return
    const next = move(order, from, to)
    setOrder(next)
    setFailed(false)
    const lane = next.filter((x) => x.hotfix === next[to].hotfix)
    const at = lane.indexOf(next[to])
    await rankTicketAction(next[to].id, lane[at - 1]?.id ?? null, lane[at + 1]?.id ?? null).catch(() => setFailed(true))
    router.refresh()
  }
  const sameLane = (a: number, b: number) => !!order[a].hotfix === !!order[b].hotfix
  const toQueueTop = async (i: number) => {
    const first = order.findIndex((x) => !!x.hotfix === !!order[i].hotfix)
    setOrder(move(order, i, first))
    setFailed(false)
    await rankFirstAction(order[i].id).catch(() => setFailed(true))
    router.refresh()
  }
  const actions = (i: number): CardAction[] => {
    const lane = order.flatMap((x, j) => (sameLane(i, j) ? [j] : []))
    const p = lane.indexOf(i)
    return [
      { label: 'Send to top', run: () => void reorder(i, lane[0]), disabled: p === 0 },
      { label: 'Send to bottom', run: () => void reorder(i, lane[lane.length - 1]), disabled: p === lane.length - 1 },
      { label: 'Move up', run: () => void reorder(i, lane[p - 1]), disabled: p === 0 },
      { label: 'Move down', run: () => void reorder(i, lane[p + 1]), disabled: p === lane.length - 1 },
      { label: 'Send to top of the queue', run: () => void toQueueTop(i), disabled: false },
    ]
  }
  const keys = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    const to = i + (e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0)
    if (!e.altKey || to === i || to < 0 || to >= order.length || !order[to].movable || !sameLane(i, to)) return
    e.preventDefault()
    const id = order[i].id
    void reorder(i, to).then(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-ticket="${id}"]`)?.focus()))
  }
  const from = order.findIndex((x) => x.id === drag)
  const drop = drag !== null && target !== null && target !== from ? target : null
  const over = (i: number) => (e: DragEvent) => {
    if (drag === null) return
    if (!order[i].movable || !sameLane(i, from)) return setTarget(null)
    e.preventDefault()
    setTarget(i)
  }
  const reset = () => {
    setDrag(null)
    setTarget(null)
  }

  return (
    <div
      className="flex flex-col gap-3"
      onDragLeave={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) setTarget(null)
      }}
    >
      {failed && <p className="small text-muted-foreground" role="alert">Could not save the new order.</p>}
      {order.map((it, i) => (
      <Card
        asChild
        key={it.id}
        className={cn(
          'card group relative items-start gap-1 bg-background p-3',
          it.movable && 'cursor-grab',
          it.running && stripe,
          it.hotfix && 'border-destructive',
          drag === it.id && 'opacity-50',
          drop === i && (from > i ? before : after),
        )}
        data-drop={drop === i ? (from > i ? 'before' : 'after') : undefined}
        data-ticket={it.id}
        data-running={it.running || undefined}
        data-lane={it.hotfix ? 'hotfix' : undefined}
        {...(it.movable && {
          draggable: true,
          tabIndex: 0,
          title: 'Drag, or Alt+ArrowUp / Alt+ArrowDown, to reorder',
          onKeyDown: keys(i),
          onDragStart: (e: DragEvent) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', String(it.id))
            setDrag(it.id)
          },
          onDragEnd: reset,
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            reset()
            if (from >= 0) void reorder(from, i)
          },
        })}
        onDragOver={over(i)}
        {...(it.movable && { onContextMenu: (e: MouseEvent) => { e.preventDefault(); setMenu(it.id) }, ...longPress(() => setMenu(it.id)) })}
      >
        <article>
          <span className="rank mono small absolute top-2 right-9 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100" aria-label={`Position ${i + 1}`}>{i + 1}</span>
          {it.movable && <CardMenu open={menu === it.id} onOpenChange={(o) => setMenu(o ? it.id : null)} actions={actions(i)} />}
          {it.node}
        </article>
      </Card>
      ))}
    </div>
  )
}
