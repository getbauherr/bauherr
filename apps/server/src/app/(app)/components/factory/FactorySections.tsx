import type { loadFactory } from '../../lib/factory'
import type { BoardView } from '../../lib/board-relations'
import { countShows, type Show } from '../../lib/factory'
import { EmptyState } from '../EmptyState'
import { FactoryBoard } from './FactoryBoard'
import { FilterRow } from './FilterRow'
import { HoldStrip } from './HoldStrip'
import { SomedayLine } from './SomedayLine'
import { TotalsLine } from './Totals'

type Factory = Promise<Awaited<ReturnType<typeof loadFactory>>>
type Props = { factory: Factory; show: Show; product: number | undefined; boardView: BoardView }

const PRODUCTS = { href: '/settings/products', label: 'Open Products settings' }

export async function FactoryTotals({ factory }: { factory: Factory }) {
  return <TotalsLine totals={(await factory).stats.totals} />
}

export async function FactoryBody({ factory, show, product, boardView }: Props) {
  const view = await factory
  if (!view.products.length) {
    return <EmptyState text="No project is connected to the lean core yet." action={PRODUCTS} />
  }
  const { stats } = view
  return (
    <>
      <FilterRow
        show={show}
        product={product}
        counts={countShows(view.parkedAndHeld, stats)}
        products={view.products}
        view={boardView}
        relationCounts={view.relations}
      />
      <HoldStrip holds={view.held} />
      <SomedayLine items={view.someday} />
      <FactoryBoard
        lanes={view.lanes}
        parents={view.parents}
        stats={stats}
        show={show}
        view={boardView}
        product={product}
      />
    </>
  )
}
