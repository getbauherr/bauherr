import { redirect } from 'next/navigation'
import { isProductOwner } from '../../../lib/people'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { FactoryBoard } from '../components/factory/FactoryBoard'
import { FilterRow } from '../components/factory/FilterRow'
import { HoldStrip } from '../components/factory/HoldStrip'
import { SomedayLine } from '../components/factory/SomedayLine'
import { TotalsLine } from '../components/factory/Totals'
import { countRelations, parseView } from '../lib/board-relations'
import { countShows, loadFactory, parseSearch } from '../lib/factory'
import { currentPersonWorkspace, payloadClient } from '../lib/session'

export const dynamic = 'force-dynamic'

const PRODUCTS = { href: '/settings/products', label: 'Open Products settings' }

type Search = { show?: string; product?: string; relation?: string; group?: string }

export default async function Factory({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, workspace } = await currentPersonWorkspace()
  if (isProductOwner(user)) redirect('/requests')
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const raw = await searchParams
  const { show, product } = parseSearch(raw)
  const boardView = parseView(raw)
  const view = await loadFactory(await payloadClient(), { workspace: workspace.id, ...(product && { product }) })
  if (!view.products.length) {
    return <EmptyState text="No project is connected to the lean core yet." action={PRODUCTS} />
  }
  const { lanes, stats } = view
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h1 className="title">Factory</h1>
        <TotalsLine totals={stats.totals} />
      </div>
      <FilterRow
        show={show}
        product={product}
        counts={countShows(lanes)}
        products={view.products}
        view={boardView}
        relationCounts={countRelations(lanes)}
      />
      <HoldStrip holds={view.held} />
      <SomedayLine items={view.someday} />
      <FactoryBoard lanes={lanes} stats={stats} show={show} view={boardView} />
      <AutoRefresh />
    </>
  )
}
