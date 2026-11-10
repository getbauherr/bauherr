import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { TicketControls } from '../components/OverviewControls'
import { TicketGraph } from '../components/TicketGraph'
import { EpicsView } from '../components/Epics'
import { WorkflowGraph } from '../components/workflow/WorkflowGraph'
import { TicketList, type Group } from '../components/workflow/TicketList'
import { epicNamed, epicRestoreUrl, epicsToShow, inEpic } from '../lib/epics'
import { loadOverview } from '../lib/overview'
import { isAdmin } from '../lib/settings'
import { currentWorkspace, payloadClient, rememberEpic, requireBauherr } from '../lib/session'
import { releaseReminders } from '../../../lib/ship-release'
import { board, DEFAULT, graph as workflowGraph } from '../../../lib/workflow'
import { checkpointOf, nodeStats, stageMedians } from '../lib/workflow-view'
import { BAR_LEGEND } from '../components/workflow/legend'

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
  const wf = DEFAULT()
  const nodes = workflowGraph(wf).nodes
  const picked = list || graph ? undefined : nodes.find((n) => n.id === sp.stage)?.id
  const hrefOf = (id: string) => {
    const next = new URLSearchParams(rest)
    id === picked ? next.delete('stage') : next.set('stage', id)
    return next.size ? `/?${next}` : '/'
  }
  const onWorkflow = !graph && !list && shown.length > 0
  const stats = onWorkflow ? nodeStats(wf, shown, data.wip, await stageMedians(await payloadClient(), workspace!.id, product)) : null
  const pickedStage = picked?.split(':')[0]
  const groups: Group[] = board(wf)
    .filter((s) => !pickedStage || s === pickedStage)
    .map((stage) => ({ stage, rows: shown.filter((t) => t.stage === stage && (!picked?.includes(':') || checkpointOf(wf, t) === picked)) }))
    .filter((g) => g.rows.length > 0 || g.stage === picked)
  return (
    <>
      <AutoRefresh />
      <h1 className="title">Workflow</h1>
      {reminders.map((r) => (
        <p key={r.product.id} role="status" data-testid="release-reminder" className="small text-warn">
          {r.product.name}: {r.count} done {r.count === 1 ? 'Ticket has' : 'Tickets have'} waited {r.days} days for a release. <Link className="text-primary" href={`/releases?product=${r.product.id}`}>Open Releases</Link>
        </p>
      ))}
      <TicketControls products={data.products} epics={data.epics} />
      {list ? (
        epics.length ? <EpicsView epics={epics} /> : <EmptyState text="No open epics." />
      ) : shown.length ? (
        graph ? <TicketGraph tickets={shown} /> : (
          <div className="flex flex-col gap-4" data-testid="workflow">
            <WorkflowGraph wf={wf} variant="full" hrefOf={hrefOf} selected={picked} stats={stats!} />
            <p className="small flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground" aria-label="Legend">
              {BAR_LEGEND.map((l) => <span key={l.label} className="flex items-center gap-1"><i className={`inline-block size-2 rounded-[1px] ${l.cls}`} />{l.label}</span>)}
              <span>Dashed lines go back to an earlier stage; dashed pills wait for you.</span>
            </p>
            {picked && <p className="small" data-testid="stage-filter">Showing {picked.includes(':') ? `the Tickets waiting at ${nodes.find((n) => n.id === picked)?.title}` : `the ${nodes.find((n) => n.id === picked)?.title} stage`}. <Link className="text-primary" href={hrefOf(picked)}>Show all stages</Link></p>}
            {groups.length ? <TicketList groups={groups} showProduct={data.products.length > 1 && !product} admin={isAdmin(user)} wip={data.wip} now={Date.now()} /> : <EmptyState text="No Tickets here." />}
          </div>
        )
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
