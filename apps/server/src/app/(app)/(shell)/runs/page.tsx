import { redirect } from 'next/navigation'
import { EmptyState } from '../../components/EmptyState'
import { RunsControls } from '../../components/OverviewControls'
import { RunsTable } from '../../components/OverviewViews'
import { epicNamed, epicRestoreUrl, inEpic } from '../../lib/epics'
import { loadOverview, RUNS_LIMIT } from '../../lib/overview'
import { currentWorkspace, rememberEpic } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Runs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { user, workspace } = await currentWorkspace()
  if (user.role !== 'admin') redirect('/')
  const data = workspace ? await loadOverview(workspace.id, false) : { tickets: [], runs: [], runsTotal: 0, products: [], epics: [] }
  const named = epicNamed(sp.epic, data.epics)
  if (named !== undefined && named !== (user.uiPrefs?.epic ?? null)) await rememberEpic(user, named)
  const restore = epicRestoreUrl('/runs', sp, user.uiPrefs?.epic, data.epics)
  if (restore) redirect(restore)
  const product = Number(sp.product) || null
  const byId = new Map(inEpic(data.tickets.filter((t) => !product || t.product?.id === product), Number(sp.epic) || null).map((t) => [t.id, t]))
  const runs = data.runs.filter((r) => byId.has(r.ticket))
  return (
    <>
      <h1 className="title">Runs</h1>
      <RunsControls products={data.products} epics={data.epics} />
      {runs.length ? (
        <>
          <RunsTable runs={runs} tickets={byId} />
          {data.runsTotal > RUNS_LIMIT && <p className="muted small">Showing the newest {RUNS_LIMIT}</p>}
        </>
      ) : (
        <EmptyState text="Runs appear after a ticket is approved." action={{ href: '/', label: 'Tickets' }} />
      )}
    </>
  )
}
