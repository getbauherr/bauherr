import type { Stats } from '../../../../core/views/stats'
import type { Board } from '../../../../core/views/board'
import { forView, rolesOf, type BoardView } from '../../lib/board-relations'
import { workersOf, type Show } from '../../lib/factory'
import { LoopArrows } from './LoopArrows'
import { ParentBands } from './ParentBands'
import { RelationScope } from './RelationScope'
import { StageColumn } from './StageColumn'

const LANE = 'relative grid grid-cols-1 items-start gap-4 md:min-w-275 md:grid-cols-6'
const BOARD = 'overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring'

type Props = { lanes: Board; stats: Stats; show: Show; view: BoardView }

export function FactoryBoard({ lanes, stats, show, view }: Props) {
  const { totals } = stats
  const numbers = new Map(Object.values(lanes.stages).flat().map((card) => [card.recordId, card.number]))
  const everyCard = [...Object.values(lanes.stages).flat(), ...lanes.parked]
  return (
    <RelationScope roles={rolesOf(lanes)}>
      <div tabIndex={0} role="region" aria-label="Factory board" className={BOARD}>
        {view.group ? (
          <ParentBands cards={forView(everyCard, view.relation)} show={show} />
        ) : (
          <div className={LANE}>
            <LoopArrows verify={totals.sentBackFromVerifyLast7Days} ship={totals.sentBackFromShipLast7Days} />
            {stats.stages.map((stat) => (
              <StageColumn
                key={stat.stage}
                stat={stat}
                cards={forView(lanes.stages[stat.stage], view.relation)}
                show={show}
                workers={workersOf(stat, numbers)}
                shipMedian={totals.medianSecondsToAccept}
                held={stat.stage === 'intake' && !view.relation ? lanes.held : []}
                parked={stat.stage === 'brief' ? forView(lanes.parked, view.relation) : []}
              />
            ))}
          </div>
        )}
      </div>
    </RelationScope>
  )
}
