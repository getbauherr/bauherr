import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Stage } from '../../../../core/events'
import type { Board, BoardCard } from '../../../../core/views/board'
import { laneCursor } from '../../../../core/views/board'
import type { BoardView } from '../../lib/board-relations'
import { groupsByParent } from '../../lib/board-relations'
import { isDimmed, LANE_PAGE, STAGE_NAMES, whoOf, type Show } from '../../lib/factory'
import { cn } from '@/lib/utils'
import { GitBranch } from '../icons'
import { BandCards } from './BandCards'
import { itemOf } from './lane-items'
import { TicketCard } from './TicketCard'

const STAGES = Object.keys(STAGE_NAMES) as Stage[]
const BAND = 'grid min-w-0 gap-3 rounded-md border border-border bg-secondary p-3 md:min-w-387'
const COLUMNS = 'grid grid-cols-1 items-start gap-4 md:grid-cols-6'
const COLUMN = 'grid min-w-0 content-start gap-2'

type Rest = { lanes: Board; view: BoardView; show: Show; product: number | undefined }

function RestLane({ stage, lanes, view, show, product }: Rest & { stage: Stage }) {
  const cards = lanes.stages[stage]
  const parked = lanes.parked.filter((card) => card.stage === stage)
  const total = lanes.totals?.[stage] ?? cards.length
  const last = cards.at(-1)
  const more =
    stage === 'done' || last === undefined
      ? undefined
      : {
          stage,
          pageSize: LANE_PAGE,
          show,
          product,
          relation: view.relation,
          parent: 'without' as const,
          total,
          cursor: cards.length < total ? laneCursor(last) : null,
        }
  const empty = cards.length + parked.length === 0
  return (
    <div role="group" aria-label={STAGE_NAMES[stage]} className={cn(COLUMN, empty && 'max-md:hidden')}>
      {!empty && <h3 className="label text-muted-foreground">{STAGE_NAMES[stage]}</h3>}
      <ul className="m-0 grid list-none gap-2 p-0">
        {parked.map((card) => (
          <li key={card.recordId} className={cn(isDimmed(show, whoOf(card)) && 'opacity-20')}>
            <TicketCard card={card} />
          </li>
        ))}
      </ul>
      <BandCards items={cards.map((card) => itemOf(card, show))} more={more} />
      {stage === 'done' && total > cards.length && (
        <Link href="/inbox#done" className="small text-primary">{total - cards.length} more</Link>
      )}
    </div>
  )
}

function Heading({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="heading flex flex-wrap items-baseline gap-x-3">{children}</h2>
}

type Props = Rest & { parents: BoardCard[] }

export function ParentBands({ parents, ...rest }: Props) {
  const { show, lanes } = rest
  const hasRest = lanes.parked.length > 0 || STAGES.some((stage) => lanes.stages[stage].length > 0)
  return (
    <div className="grid gap-4">
      {groupsByParent(parents).map(({ key, parent, cards: members }) => (
        <section key={key} aria-labelledby={key} className={BAND}>
          <Heading id={key}>
            {parent && (
              <>
                <GitBranch className="size-4 self-center" />
                <span className="mono">#{parent.number}</span> {parent.title}
                <span className="small text-muted-foreground">
                  {parent.parts.done}/{parent.parts.total} parts done
                </span>
              </>
            )}
          </Heading>
          <div className={COLUMNS}>
            {STAGES.map((stage) => {
              const inStage = members.filter((card) => card.stage === stage)
              return (
                <div key={stage} className={cn(COLUMN, !inStage.length && 'max-md:hidden')}>
                  {inStage.length > 0 && <h3 className="label text-muted-foreground">{STAGE_NAMES[stage]}</h3>}
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {inStage.map((card) => (
                      <li key={card.recordId} className={cn(isDimmed(show, whoOf(card)) && 'opacity-20')}>
                        <TicketCard card={card} />
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {hasRest && (
        <section aria-labelledby="no-parent" className={BAND}>
          <Heading id="no-parent">No parent</Heading>
          <div className={COLUMNS}>
            {STAGES.map((stage) => (
              <RestLane key={stage} stage={stage} {...rest} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
