import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { activeHolds } from '../../../core/forge/limits'
import { isProductOwner } from '../../../lib/people'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { ForgeHoldBanner } from '../components/factory/ForgeHoldBanner'
import { FactoryBody, FactoryTotals } from '../components/factory/FactorySections'
import { BoardSkeleton } from '../components/skeletons'
import { Skeleton } from '../components/ui/skeleton'
import { BOARD_TABLES } from '../lib/change-tables'
import { parseView } from '../lib/board-relations'
import { loadFactory, parseSearch } from '../lib/factory'
import { currentPersonWorkspace, payloadClient } from '../lib/session'

export const dynamic = 'force-dynamic'

type Search = { show?: string; product?: string; relation?: string; group?: string }

export default async function Factory({ searchParams }: { searchParams: Promise<Search> }) {
  const { user, workspace } = await currentPersonWorkspace()
  if (isProductOwner(user)) redirect('/requests')
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const raw = await searchParams
  const { show, product } = parseSearch(raw)
  const boardView = parseView(raw)
  const payload = await payloadClient()
  const factory = loadFactory(payload, { workspace: workspace.id, ...(product && { product }) }, boardView)
  const holds = await activeHolds(payload, workspace.id, new Date())
  return (
    <>
      <ForgeHoldBanner holds={holds.map(({ message, until }) => ({ message, until: until.toISOString() }))} />
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h1 className="title">Factory</h1>
        <Suspense fallback={<Skeleton className="h-4 w-72" />}>
          <FactoryTotals factory={factory} />
        </Suspense>
      </div>
      <Suspense fallback={<BoardSkeleton />}>
        <FactoryBody factory={factory} show={show} product={product} boardView={boardView} />
      </Suspense>
      <AutoRefresh tables={BOARD_TABLES} />
    </>
  )
}
