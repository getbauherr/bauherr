import { redirect } from 'next/navigation'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { TicketControls } from '../components/OverviewControls'
import { TicketGraph } from '../components/TicketGraph'
import { BoardView } from '../components/OverviewViews'
import { loadOverview } from '../lib/overview'
import { currentWorkspace } from '../lib/session'

export const dynamic = 'force-dynamic'

export default async function Tickets({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { view, ...sp } = await searchParams
  const rest = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])
  if (view === 'runs') redirect(`/runs${rest.has('product') ? `?product=${encodeURIComponent(rest.get('product')!)}` : ''}`)
  const graph = view === 'graph'
  if (view && !graph) redirect(rest.size ? `/?${rest}` : '/')
  const { workspace } = await currentWorkspace()
  const data = workspace ? await loadOverview(workspace.id, sp.state === 'all' && !graph) : { tickets: [], products: [], lookupsCapped: false }
  const product = Number(sp.product) || null
  const inProduct = data.tickets.filter((t) => !product || t.product?.id === product)
  const shown = sp.state === 'all' && !graph ? inProduct : inProduct.filter((t) => t.open)
  return (
    <>
      <AutoRefresh />
      <h1 className="title">Tickets</h1>
      <TicketControls products={data.products} />
      {shown.length ? (
        graph ? <TicketGraph tickets={shown} /> : <BoardView tickets={shown} capped={data.lookupsCapped} />
      ) : (
        <EmptyState text={`No tickets in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/settings/workspace', label: 'Open settings' }} />
      )}
    </>
  )
}
