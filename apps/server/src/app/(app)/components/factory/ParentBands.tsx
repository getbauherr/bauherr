import type { Stage } from '../../../../core/events'
import type { BoardCard } from '../../../../core/views/board'
import { groupsByParent } from '../../lib/board-relations'
import { isDimmed, STAGE_NAMES, whoOf, type Show } from '../../lib/factory'
import { cn } from '@/lib/utils'
import { GitBranch } from '../icons'
import { TicketCard } from './TicketCard'

const STAGES = Object.keys(STAGE_NAMES) as Stage[]
const BAND = 'grid min-w-0 gap-3 rounded-md border border-border bg-secondary p-3 md:min-w-275'

export function ParentBands({ cards, show }: { cards: BoardCard[]; show: Show }) {
  return (
    <div className="grid gap-4">
      {groupsByParent(cards).map(({ key, parent, cards: members }) => (
        <section key={key} aria-labelledby={key} className={BAND}>
          <h2 id={key} className="heading flex flex-wrap items-baseline gap-x-3">
            {parent ? (
              <>
                <GitBranch className="size-4 self-center" />
                <span className="mono">#{parent.number}</span> {parent.title}
                <span className="small text-muted-foreground">
                  {parent.parts.done}/{parent.parts.total} parts done
                </span>
              </>
            ) : (
              'No parent'
            )}
          </h2>
          <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-6">
            {STAGES.map((stage) => {
              const inStage = members.filter((card) => card.stage === stage)
              return (
                <div key={stage} className={cn('grid min-w-0 content-start gap-2', !inStage.length && 'max-md:hidden')}>
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
    </div>
  )
}
