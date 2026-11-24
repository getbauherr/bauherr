import { insightsPage } from '../../../../core/views/insights-page'
import { EmptyState } from '../../components/EmptyState'
import { PageTitle } from '../../components/PageTitle'
import { CostTable, TopTickets } from '../../components/insights/CostTables'
import { Filters } from '../../components/insights/Filters'
import { SummaryRow } from '../../components/insights/SummaryRow'
import { TimeBars } from '../../components/insights/TimeBars'
import { parseInsights } from '../../lib/insights'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ days?: string; product?: string }> }

export default async function InsightsPage({ searchParams }: Props) {
  const { workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const { days, product } = parseInsights(await searchParams)
  const view = await insightsPage(await payloadClient(), { workspace: workspace.id, product, days, now: new Date() })
  return (
    <>
      <PageTitle>Insights</PageTitle>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Insights</h1>
        <Filters days={view.days} product={view.product} products={view.products} />
      </div>
      {view.time.done === 0 ? (
        <EmptyState text={`No ticket was done in the last ${view.days} days. Pick a longer range.`} />
      ) : (
        <>
          <SummaryRow view={view} />
          <TimeBars time={view.time} />
          <CostTable cost={view.cost} outside={view.outside} />
          <TopTickets cost={view.cost} />
        </>
      )}
    </>
  )
}
