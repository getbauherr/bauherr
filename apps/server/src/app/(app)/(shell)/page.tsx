import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { TicketControls } from '../components/OverviewControls'
import { TicketGraph } from '../components/TicketGraph'
import { EpicsView } from '../components/Epics'
import { BoardView } from '../components/OverviewViews'
import { epicNamed, epicRestoreUrl, epicsToShow, inEpic } from '../lib/epics'
import { loadOverview } from '../lib/overview'
import { isAdmin } from '../lib/settings'
import { currentWorkspace, payloadClient, rememberEpic, requireBauherr } from '../lib/session'
import { releaseReminders } from '../../../lib/ship-release'

export const dynamic = 'force-dynamic'

export default async function Tickets({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const all = await searchParams
  const { view, ...sp } = all
  const rest = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])
  if (view === 'runs') redirect(`/runs${rest.has('product') ? `?product=${encodeURIComponent(rest.get('product')!)}` : ''}`)
  const graph = view === 'graph'
  const list = view === 'epics'
  if (view && !graph && !list) redirect(rest.size ? `/?${rest}` : '/')
  const { workspace } = await currentWorkspace()
  const data = workspace ? await loadOverview(workspace.id, sp.state === 'all' && !graph) : { tickets: [], products: [], epics: [], wip: {} }
  const user = await requireBauherr()
  const named = list ? undefined : epicNamed(sp.epic, data.epics)
  if (named !== undefined && named !== (user.uiPrefs?.epic ?? null)) await rememberEpic(user, named)
  const restore = list ? null : epicRestoreUrl('/', all, user.uiPrefs?.epic, data.epics)
  if (restore) redirect(restore)
  const product = Number(sp.product) || null
  const epicIds = new Set(data.epics.map((e) => e.id))
  const inProduct = inEpic(data.tickets.filter((t) => !epicIds.has(t.id) && (!product || t.product?.id === product)), Number(sp.epic) || null)
  const epics = epicsToShow(data.epics, sp.done === '1', product)
  const reminders = workspace && !graph && !list ? await releaseReminders(await payloadClient(), workspace.id) : []
  const shown = sp.state === 'all' && !graph ? inProduct : inProduct.filter((t) => t.open)
  return (
    <>
      <AutoRefresh ms={10000} />
      <h1 className="title">Tickets</h1>
      {reminders.map((r) => (
        <p key={r.product.id} role="status" data-testid="release-reminder" className="small text-warn">
          {r.product.name}: {r.count} done {r.count === 1 ? 'Ticket has' : 'Tickets have'} waited {r.days} days for a release. <Link className="text-primary" href={`/releases?product=${r.product.id}`}>Open Releases</Link>
        </p>
      ))}
      <TicketControls products={data.products} epics={data.epics} />
      {list ? (
        epics.length ? <EpicsView epics={epics} /> : <EmptyState text="No open epics." />
      ) : shown.length ? (
        graph ? <TicketGraph tickets={shown} /> : <BoardView tickets={shown} showProduct={data.products.length > 1 && !product} admin={isAdmin(user)} wip={data.wip} />
      ) : sp.epic ? (
        <EmptyState text="No open tickets in this epic." action={{ href: '/?epic=', label: 'Clear the epic filter' }} />
      ) : !data.products.length ? (
        <EmptyState text={`No tickets in ${workspace?.name ?? 'any Workspace'} yet.${isAdmin(user) ? '' : ' Ask an Admin to set up the Workspace.'}`} action={isAdmin(user) ? { href: '/setup', label: 'Set up your Workspace' } : undefined} />
      ) : product ? (
        <EmptyState text="No open tickets in this Product." action={{ href: '/?product=', label: 'Clear the Product filter' }} />
      ) : (
        <EmptyState text="Describe what you want built." action={{ href: '/requests/new', label: 'New request' }} />
      )}
    </>
  )
}
