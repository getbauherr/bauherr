import type { StageStat, Stats } from '../../../../core/views/stats'
import type { Board, BoardCard } from '../../../../core/views/board'
import { laneCursor } from '../../../../core/views/board'
import { blockingFirst, rolesOf, type BoardView } from '../../lib/board-relations'
import { LANE_PAGE, workersOf, type Show } from '../../lib/factory'
import { LoopArrows } from './LoopArrows'
import { ParentBands } from './ParentBands'
import { RelationScope } from './RelationScope'
import { StageColumn } from './StageColumn'

const LANE = 'relative grid grid-cols-1 items-start gap-4 md:min-w-380 md:grid-cols-6'

const moreOf = (cards: BoardCard[], stat: StageStat, lanes: Board, view: BoardView, show: Show, product?: number) => {
  const last = cards.at(-1)
  if (stat.stage === 'done' || last === undefined) return undefined
  const total = lanes.totals?.[stat.stage] ?? stat.total
  return {
    stage: stat.stage,
    pageSize: LANE_PAGE,
    show,
    product,
    relation: view.relation,
    total,
    cursor: cards.length < total ? laneCursor(last) : null,
  }
}

type Props = {
  lanes: Board
  parents: Board | null
  stats: Stats
  show: Show
  view: BoardView
  product: number | undefined
}

const cardsOf = (board: Board): BoardCard[] => [...Object.values(board.stages).flat(), ...board.parked]

export function FactoryBoard({ lanes, parents, stats, show, view, product }: Props) {
  const { totals } = stats
  const everyCard = parents ? [...cardsOf(parents), ...cardsOf(lanes)] : cardsOf(lanes)
  return (
    <RelationScope roles={rolesOf(everyCard)}>
      <div role="region" aria-label="Factory board">
        {parents ? (
          <ParentBands
            parents={cardsOf(parents)}
            lanes={lanes}
            view={view}
            show={show}
            product={product}
          />
        ) : (
          <div className={LANE}>
            <LoopArrows verify={totals.sentBackFromVerifyLast7Days} ship={totals.sentBackFromShipLast7Days} />
            {stats.stages.map((stat) => (
              <StageColumn
                key={stat.stage}
                stat={stat}
                cards={blockingFirst(lanes.stages[stat.stage])}
                show={show}
                workers={workersOf(stat)}
                shipMedian={totals.medianSecondsToAccept}
                doneTotal={lanes.totals?.done ?? stat.total}
                more={moreOf(lanes.stages[stat.stage], stat, lanes, view, show, product)}
                held={stat.stage === 'intake' ? lanes.held : []}
                parked={stat.stage === 'brief' ? lanes.parked : []}
              />
            ))}
          </div>
        )}
      </div>
    </RelationScope>
  )
}
