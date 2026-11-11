import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AutoRefresh } from '../components/AutoRefresh'
import { EmptyState } from '../components/EmptyState'
import { TicketControls } from '../components/OverviewControls'
import { TicketGraph } from '../components/TicketGraph'
import { EpicsView } from '../components/Epics'
import { WorkflowGraph } from '../components/workflow/WorkflowGraph'
import { TicketList, type Group } from '../components/workflow/TicketList'
import { loadTeam } from '../../../lib/sessions'
import { resolveMode } from '../../../lib/mode'
import { epicNamed, epicRestoreUrl, epicsToShow, inEpic } from '../lib/epics'
import { loadOverview } from '../lib/overview'
import { isAdmin } from '../lib/settings'
import { needsSetup } from '../lib/setup'
import { currentWorkspace, payloadClient, rememberEpic, requireBauherr } from '../lib/session'
import { releaseReminders } from '../../../lib/ship-release'
import { workflowFor } from '../../../lib/factory'
import { board, byKind, graph as workflowGraph } from '../../../lib/workflow'
import { checkpointOf, nodeStats, stageAgents, stageMedians } from '../lib/workflow-view'
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
  if (workspace && needsSetup(isAdmin(user), data.products.length)) redirect('/setup')
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
  const wf = workflowFor(workspace?.id)
  const nodes = workflowGraph(wf).nodes
  const picked = list || graph ? undefined : nodes.find((n) => n.id === sp.stage)?.id
  const hrefOf = (id: string) => {
    const next = new URLSearchParams(rest)
    id === picked ? next.delete('stage') : next.set('stage', id)
    return next.size ? `/?${next}` : '/'
  }
  const onWorkflow = !graph && !list && shown.length > 0
  const payload = await payloadClient()
  const modes = onWorkflow ? ((await payload.findByID({ collection: 'workspaces', id: workspace!.id, select: { defaultMode: true, modeByStage: true }, depth: 0, overrideAccess: true })) as { defaultMode?: string | null; modeByStage?: Record<string, unknown> | null }) : {}
  const [medians, team] = onWorkflow ? await Promise.all([stageMedians(payload, workspace!.id, product), loadTeam(payload, workspace!.id)]) : [{}, null]
  const stats = onWorkflow ? { ...nodeStats(wf, shown, data.wip, medians), agents: stageAgents(wf, team!.roles, (st) => resolveMode(wf, modes, st)) } : null
  const pickedStage = picked?.split(':')[0]
  const groups: Group[] = board(wf)
    .filter((s) => !pickedStage || s === pickedStage)
    .map((stage) => ({ stage, rows: shown.filter((t) => t.stage === stage && (!picked?.includes(':') || checkpointOf(wf, t) === picked)) }))
    .filter((g) => g.rows.length > 0 || g.stage === picked)
  return (
    <>
      <AutoRefresh />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="title">Workflow</h1>
        {isAdmin(user) && <Link className="small text-primary" href="/settings/workflow#factory-file">Edit workflow</Link>}
      </div>
      {reminders.map((r) => (
        <p key={r.product.id} role="status" data-testid="release-reminder" className="small text-warn">
          {r.product.name}: {r.count} done {r.count === 1 ? 'Ticket has' : 'Tickets have'} waited {r.days} days for a release. <Link className="text-primary" href={`/releases?product=${r.product.id}`}>Open Releases</Link>
        </p>
      ))}
      <TicketControls products={data.products} epics={data.epics} />
      {list ? (
        epics.length ? <EpicsView wf={wf} epics={epics} /> : <EmptyState text="No open epics." />
      ) : shown.length ? (
        graph ? <TicketGraph wf={wf} tickets={shown} /> : (
          <div className="flex flex-col gap-4" data-testid="workflow">
            <WorkflowGraph wf={wf} variant="full" hrefOf={hrefOf} selected={picked} stats={stats!} />
            <p className="small flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground" aria-label="Legend">
              {BAR_LEGEND.map((l) => <span key={l.label} className="flex items-center gap-1"><i className={`inline-block size-2 rounded-[1px] ${l.cls}`} />{l.label}</span>)}
              <span>Dashed lines go back to an earlier stage; dashed pills wait for you.</span>
            </p>
            {picked && <p className="small" data-testid="stage-filter">{stats?.agents?.get(picked)?.missing && <><Link className="text-warn" href="/team" data-testid="no-agent-link">No agent connected for this stage: open Team</Link> · </>}Showing {picked.includes(':') ? `the Tickets waiting at ${nodes.find((n) => n.id === picked)?.title}` : `the ${nodes.find((n) => n.id === picked)?.title} stage`}. <Link className="text-primary" href={hrefOf(picked)}>Show all stages</Link>{picked.includes(':') && !!stats?.checkpoints.get(picked) && <> · <Link className="text-primary" href={`/inbox?checkpoint=${encodeURIComponent(nodes.find((n) => n.id === picked)?.title ?? '')}`} data-testid="decide-in-inbox">Decide in Inbox ({stats.checkpoints.get(picked)})</Link></>}</p>}
            {groups.length ? <TicketList wf={wf} groups={groups} collapsed={!picked && sp.state !== 'all' ? byKind(wf, 'done')?.name : undefined} expandHref={hrefOf(byKind(wf, 'done')?.name ?? '')} sticky={!picked} showProduct={data.products.length > 1 && !product} admin={isAdmin(user)} wip={data.wip} now={Date.now()} /> : <EmptyState text="No Tickets here." />}
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
