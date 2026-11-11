import { InsightsView } from '../../components/insights/InsightsView'
import { InsightsControls } from '../../components/OverviewControls'
import { loadInsights, RANGES, wipAge } from '../../lib/insights'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { workflowFor } from '../../../../lib/factory'
import { EmptyState } from '../../components/EmptyState'

export const dynamic = 'force-dynamic'

export default async function Insights({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { workspace } = await currentWorkspace()
  const days = RANGES.find((r) => String(r) === sp.range) ?? 30
  if (!workspace) return <EmptyState text="No Workspace selected." />
  const wf = workflowFor(workspace.id)
  const payload = await payloadClient()
  const products = (await payload.find({ collection: 'products', where: { workspace: { equals: workspace.id } }, sort: 'name', pagination: false, depth: 0, overrideAccess: true, select: { name: true } })).docs as unknown as { id: number; name: string }[]
  const product = products.find((p) => String(p.id) === sp.product)?.id ?? null
  const [data, wip] = await Promise.all([loadInsights(payload, wf, workspace.id, { days, product }), wipAge(payload, wf, workspace.id, product)])
  return (
    <>
      <h1 className="title">Insights</h1>
      <InsightsControls products={products} days={days} ranges={RANGES} />
      <InsightsView wf={wf} data={data} wip={wip} days={days} />
    </>
  )
}
