'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { rankFirstAction, rankTicketAction } from '../../lib/actions'
import { cn } from '@/lib/utils'
import { CardMenu, longPress, type CardAction } from '../CardMenu'

type Item = { id: number; cells: ReactNode[]; movable: boolean; running?: boolean; hotfix?: boolean }

/** Column classes, one per cell of an item; the last column is the row menu. */
export const COLUMNS = [
  { head: '#', col: 'w-14', cell: '' },
  { head: 'Ticket', col: '', cell: '' },
  { head: 'Product', col: 'hidden w-32 @min-[800px]:table-column', cell: 'hidden @min-[800px]:table-cell' },
  { head: 'Status', col: 'w-44 @min-[640px]:w-[17rem]', cell: '' },
  { head: 'Who', col: 'hidden w-60 @min-[960px]:table-column', cell: 'hidden @min-[960px]:table-cell' },
  { head: 'In stage for', col: 'hidden w-24 @min-[640px]:table-column', cell: 'hidden @min-[640px]:table-cell' },
] as const

const move = <T,>(xs: T[], from: number, to: number): T[] => {
  const out = [...xs]
  out.splice(to, 0, out.splice(from, 1)[0])
  return out
}

/** The rows of one stage: sortable by drag and drop, Alt+ArrowUp/Down or the row menu; a move persists via `rankTicketAction`. The Hotfix lane sits above the ranked rows and is ranked on its own: neighbours are always those of the same lane. */
export function SortableRows({ items, head }: { items: Item[]; head: boolean }) {
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
    <table
      data-slot="table"
      className="w-full table-fixed border-collapse border border-border bg-card text-left [&_td]:border-t [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:bg-secondary [&_th]:px-3 [&_th]:py-2 [&_th]:text-left"
      onDragLeave={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom) setTarget(null)
      }}
    >
      <colgroup>
        {COLUMNS.map((c) => <col key={c.head} className={c.col} />)}
        <col className="w-10" />
      </colgroup>
      <thead className={head ? 'label' : 'sr-only'}>
        <tr>{COLUMNS.map((c) => <th key={c.head} className={c.cell}>{c.head}</th>)}<th><span className="sr-only">Actions</span></th></tr>
      </thead>
      <tbody>
        {failed && <tr><td colSpan={COLUMNS.length + 1} className="small text-muted-foreground" role="alert">Could not save the new order.</td></tr>}
        {order.map((it, i) => (
          <tr
            key={it.id}
            className={cn(
              'card group relative bg-card',
              it.movable && 'cursor-grab',
              it.hotfix && '[&>td:first-child]:shadow-[inset_3px_0_0_var(--danger)]',
              drag === it.id && 'opacity-50',
              'data-[drop=before]:[&>td]:shadow-[inset_0_2px_0_0_var(--accent)] data-[drop=after]:[&>td]:shadow-[inset_0_-2px_0_0_var(--accent)]',
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
            {it.cells.map((c, k) => <td key={k} className={COLUMNS[k]!.cell}>{c}</td>)}
            <td className="text-right">{it.movable && <CardMenu open={menu === it.id} onOpenChange={(o) => setMenu(o ? it.id : null)} actions={actions(i)} />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
