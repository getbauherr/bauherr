import type { StageStat, Stats } from '../../../../core/views/stats'
import type { Board, BoardCard } from '../../../../core/views/board'
import { laneCursor } from '../../../../core/views/board'
import { forView, rolesOf, type BoardView } from '../../lib/board-relations'
import { LANE_PAGE, workersOf, type Show } from '../../lib/factory'
import { LoopArrows } from './LoopArrows'
import { ParentBands } from './ParentBands'
import { RelationScope } from './RelationScope'
import { StageColumn } from './StageColumn'

const LANE = 'relative grid grid-cols-1 items-start gap-4 md:min-w-275 md:grid-cols-6'
const BOARD = 'overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring'

const moreOf = (cards: BoardCard[], stat: StageStat, chunked: boolean, show: Show, product: number | undefined) => {
  const last = cards.at(-1)
  if (!chunked || stat.stage === 'done' || last === undefined) return undefined
  return {
    stage: stat.stage,
    pageSize: LANE_PAGE,
    show,
    product,
    total: stat.total,
    cursor: cards.length < stat.total ? laneCursor(last) : null,
  }
}

type Props = { lanes: Board; stats: Stats; show: Show; view: BoardView; product: number | undefined }

export function FactoryBoard({ lanes, stats, show, view, product }: Props) {
  const chunked = view.relation === undefined && !view.group
  const { totals } = stats
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
                workers={workersOf(stat)}
                shipMedian={totals.medianSecondsToAccept}
                doneTotal={stat.total}
                more={moreOf(lanes.stages[stat.stage], stat, chunked, show, product)}
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
