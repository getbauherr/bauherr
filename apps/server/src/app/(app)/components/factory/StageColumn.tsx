import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { HeldItem } from '../../../../core/intake/held'
import type { BoardCard } from '../../../../core/views/board'
import type { StageStat } from '../../../../core/views/stats'
import { isDimmed, whoOf, type Show, type Worker } from '../../lib/factory'
import { HeldCard } from './HeldCard'
import { StageHeader } from './StageHeader'
import { TicketCard } from './TicketCard'

const DONE_SHOWN = 3
const COLUMN = 'grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2'
const FADE = 'transition-opacity duration-(--duration-state) ease-(--ease-out) motion-reduce:transition-none'

type Props = {
  stat: StageStat
  cards: BoardCard[]
  show: Show
  workers: Worker[]
  shipMedian: number | null
  held?: HeldItem[]
  parked?: BoardCard[]
}

const row = (key: string, dimmed: boolean, node: ReactNode) => (
  <li key={key} className={cn(FADE, dimmed && 'opacity-20')}>{node}</li>
)

export function StageColumn({ stat, cards, show, workers, shipMedian, held = [], parked = [] }: Props) {
  const shown = stat.stage === 'done' ? cards.slice(0, DONE_SHOWN) : cards
  const rows = (list: BoardCard[]) =>
    list.map((card) => row(String(card.recordId), isDimmed(show, whoOf(card)), <TicketCard card={card} />))
  return (
    <section className={COLUMN} aria-labelledby={`stage-${stat.stage}`}>
      <StageHeader stat={stat} workers={workers} shipMedian={shipMedian} />
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows(shown)}
        {rows(parked)}
        {held.map((entry) => row(`held-${entry.itemId}`, isDimmed(show, 'others'), <HeldCard item={entry} />))}
      </ul>
      {stat.stage === 'done' && cards.length > DONE_SHOWN && (
        <Link href="/inbox#done" className="small text-primary">{cards.length - DONE_SHOWN} more</Link>
      )}
    </section>
  )
}
