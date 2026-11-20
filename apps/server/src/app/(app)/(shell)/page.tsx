import { isProductOwner } from '../../../lib/people'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { FilterRow } from '../components/factory/FilterRow'
import { HoldStrip } from '../components/factory/HoldStrip'
import { LoopArrows } from '../components/factory/LoopArrows'
import { StageColumn } from '../components/factory/StageColumn'
import { TotalsLine } from '../components/factory/Totals'
import { countShows, loadFactory, parseSearch, workersOf } from '../lib/factory'
import { currentPersonWorkspace, payloadClient } from '../lib/session'

export const dynamic = 'force-dynamic'

const LANE = 'relative grid grid-cols-1 items-start gap-4 md:min-w-275 md:grid-cols-6'
const BOARD = 'overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring'

const PROFILE = { href: '/settings/profile', label: 'Open your profile' }
const PRODUCTS = { href: '/settings/products', label: 'Open Products settings' }

type Search = { show?: string; product?: string }

export default async function Factory({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, workspace } = await currentPersonWorkspace()
  if (isProductOwner(user)) {
    return <EmptyState text="The Factory view is for Bauherren in this version." action={PROFILE} />
  }
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { show, product } = parseSearch(await searchParams)
  const view = await loadFactory(await payloadClient(), { workspace: workspace.id, ...(product && { product }) })
  if (!view.products.length) {
    return <EmptyState text="No project is connected to the lean core yet." action={PRODUCTS} />
  }
  const { lanes, stats } = view
  const numbers = new Map(Object.values(lanes.stages).flat().map((card) => [card.recordId, card.number]))
  const { totals } = stats
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h1 className="title">Factory</h1>
        <TotalsLine totals={totals} />
      </div>
      <FilterRow show={show} product={product} counts={countShows(lanes)} products={view.products} />
      <HoldStrip holds={view.held} />
      <div tabIndex={0} role="region" aria-label="Factory board" className={BOARD}>
        <div className={LANE}>
          <LoopArrows verify={totals.sentBackFromVerifyLast7Days} ship={totals.sentBackFromShipLast7Days} />
          {stats.stages.map((stat) => (
            <StageColumn
              key={stat.stage}
              stat={stat}
              cards={lanes.stages[stat.stage]}
              show={show}
              workers={workersOf(stat, numbers)}
              shipMedian={totals.medianSecondsToAccept}
              held={stat.stage === 'intake' ? lanes.held : []}
              parked={stat.stage === 'brief' ? lanes.parked : []}
            />
          ))}
        </div>
      </div>
      <AutoRefresh />
    </>
  )
}
