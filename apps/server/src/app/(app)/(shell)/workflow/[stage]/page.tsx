import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { StageJobs } from '../../../components/workflow/StageJobs'
import { TicketList } from '../../../components/workflow/TicketList'
import { jobTickets, stageJobs } from '../../../lib/job-view'
import { loadOverview } from '../../../lib/overview'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'
import { liveJobRuns } from '../../../lib/workflow-view'
import { workflowFor } from '../../../../../lib/factory'
import { stage as stageOf } from '../../../../../lib/workflow'
import { STEP_TEXT } from '../../../../../lib/workflow-labels'

export const dynamic = 'force-dynamic'

export default async function StagePage({ params, searchParams }: { params: Promise<{ stage: string }>; searchParams: Promise<{ job?: string }> }) {
  const [{ stage: name }, { job }] = await Promise.all([params, searchParams])
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const wf = workflowFor(workspace.id)
  const def = stageOf(wf, name)
  if (!def || def.kind === 'container' || def.kind === 'done') notFound()
  const jobs = stageJobs(def)
  const data = await loadOverview(workspace.id, false)
  const live = await liveJobRuns(await payloadClient(), workspace.id)
  const here = data.tickets.filter((t) => t.open && (t.slicing?.stage ?? t.stage) === def.name)
  const byJob = jobTickets(wf, data.tickets, live, def.name).get(def.name)!
  const picked = jobs.find((j) => j.id === job)
  const inJob = new Set(picked ? byJob.get(picked.id) : [])
  const rows = picked ? here.filter((t) => inJob.has(t.id)) : here
  const numbers = new Map(data.tickets.map((t) => [t.id, { id: t.id, number: t.number, title: t.title }]))
  const hrefOf = (id: string) => (id === picked?.id ? `/workflow/${def.name}` : `/workflow/${def.name}?job=${id}`)
  return (
    <>
      <AutoRefresh />
      <PageTitle>{def.title}</PageTitle>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="title">{def.title}</h1>
        <span className="small flex gap-4">
          <Link className="text-primary" href="/">All stages</Link>
          {isAdmin(user) && <Link className="text-primary" href="/workflow/edit">Edit workflow</Link>}
        </span>
      </div>
      <p className="small m-0 text-muted-foreground">{STEP_TEXT[def.kind]}. {jobs.length === 1 ? 'One Job.' : `${jobs.length} Jobs.`} {here.length} open {here.length === 1 ? 'Ticket' : 'Tickets'} in the stage.</p>
      <div className="flex flex-col gap-4" data-testid="stage-page" data-stage={def.name}>
        <StageJobs wf={wf} jobs={jobs} tickets={new Map([...byJob].map(([id, ids]) => [id, ids.flatMap((i) => numbers.get(i) ?? [])]))} selected={picked?.id} hrefOf={hrefOf} />
        {picked && <p className="small m-0" data-testid="job-filter">Showing the Tickets in {picked.title}. <Link className="text-primary" href={hrefOf(picked.id)}>Show all Tickets of the stage</Link></p>}
        {rows.length ? (
          <TicketList wf={wf} groups={[{ stage: def.name, rows }]} showProduct={data.products.length > 1} admin={isAdmin(user)} wip={data.wip} now={Date.now()} />
        ) : (
          <EmptyState text={picked ? `No Tickets in ${picked.title} right now.` : `No open Tickets in ${def.title}.`} action={picked ? { href: hrefOf(picked.id), label: 'Show all Tickets of the stage' } : { href: '/', label: 'Back to the Workflow' }} />
        )}
      </div>
    </>
  )
}
