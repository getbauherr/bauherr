import { redirect } from 'next/navigation'
import { EmptyState } from '../components/EmptyState'
import { OverviewControls } from '../components/OverviewControls'
import { BoardView, ListView, RunsTable } from '../components/OverviewViews'
import { VIEWS, type View } from '../lib/needs-you'
import { loadOverview, RUNS_LIMIT } from '../lib/overview'
import { currentWorkspace } from '../lib/session'

export const dynamic = 'force-dynamic'

export default async function Tickets({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const { user, workspace } = await currentWorkspace()
  const saved = user.uiPrefs?.view
  if (!VIEWS.includes(sp.view as View)) {
    const next = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])
    next.set('view', VIEWS.includes(saved as View) ? saved! : 'list')
    redirect(`/?${next}`)
  }
  const view = sp.view as View
  const data = workspace ? await loadOverview(workspace.id, sp.state === 'all') : { tickets: [], runs: [], runsTotal: 0, products: [], lookupsCapped: false }
  const product = Number(sp.product) || null
  const inProduct = data.tickets.filter((t) => !product || t.product?.id === product)
  const shown = sp.state === 'all' ? inProduct : inProduct.filter((t) => t.open)
  const byId = new Map(inProduct.map((t) => [t.id, t]))
  const runs = data.runs.filter((r) => byId.has(r.ticket))
  const empty = view === 'runs' ? !runs.length : !shown.length
  return (
    <>
      <h1 className="title">Tickets</h1>
      <OverviewControls view={view} products={data.products} />
      {empty ? (
        <EmptyState
          text={`No ${view === 'runs' ? 'runs' : 'tickets'} in ${workspace?.name ?? 'any Workspace'} yet.`}
          action={{ href: '/settings/workspace', label: 'Open settings' }}
        />
      ) : view === 'list' ? (
        <ListView tickets={shown} capped={data.lookupsCapped} />
      ) : view === 'board' ? (
        <BoardView tickets={shown} />
      ) : (
        <>
          <RunsTable runs={runs} tickets={byId} />
          {data.runsTotal > RUNS_LIMIT && <p className="muted small">Showing the newest {RUNS_LIMIT}</p>}
        </>
      )}
    </>
  )
}
