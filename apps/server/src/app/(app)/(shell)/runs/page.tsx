import { EmptyState } from '../../components/EmptyState'
import { RunsControls } from '../../components/OverviewControls'
import { RunsTable } from '../../components/OverviewViews'
import { loadOverview, RUNS_LIMIT } from '../../lib/overview'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Runs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { workspace } = await currentWorkspace()
  const data = workspace ? await loadOverview(workspace.id, false) : { tickets: [], runs: [], runsTotal: 0, products: [] }
  const product = Number(sp.product) || null
  const byId = new Map(data.tickets.filter((t) => !product || t.product?.id === product).map((t) => [t.id, t]))
  const runs = data.runs.filter((r) => byId.has(r.ticket))
  return (
    <>
      <h1 className="title">Runs</h1>
      <RunsControls products={data.products} />
      {runs.length ? (
        <>
          <RunsTable runs={runs} tickets={byId} />
          {data.runsTotal > RUNS_LIMIT && <p className="muted small">Showing the newest {RUNS_LIMIT}</p>}
        </>
      ) : (
        <EmptyState text={`No runs in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/settings/workspace', label: 'Open settings' }} />
      )}
    </>
  )
}
