import Link from 'next/link'
import { RunNotFound } from '../../../../../core/run/errors'
import { runPage } from '../../../../../core/views/run'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { RunAside } from '../../../components/ticket/RunAside'
import { RunSteps } from '../../../components/ticket/RunSteps'
import { Time } from '../../../components/Time'
import { WordBadge } from '../../../components/WordBadge'
import { ROLE_WORDS, RUN_WORDS } from '../../../lib/ticket'
import { RUN_NAMES, workerOf } from '../../../lib/factory'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const GONE = { href: '/', label: 'Back to the Factory' }

export default async function RunPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { user, workspace } = await currentWorkspace()
  const runId = Number((await params).id)
  if (!workspace || !Number.isInteger(runId) || runId <= 0) {
    return <EmptyState text="This run does not exist." action={GONE} />
  }
  const admin = user.role === 'admin'
  const run = await runPage(await payloadClient(), { workspace: workspace.id, runId, withCost: admin }).catch(
    (error: unknown) => {
      if (error instanceof RunNotFound) return null
      throw error
    },
  )
  if (!run) return <EmptyState text="This run does not exist." action={GONE} />
  const { ticket } = run
  return (
    <>
      <PageTitle>{`Run ${run.id}`}</PageTitle>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/tickets/${ticket.recordId}`} className="text-primary hover:underline">
          #{ticket.number} {ticket.title}
        </Link>
        <h1 className="title mono">Run {run.id}</h1>
        <WordBadge word={RUN_WORDS[run.status] ?? { word: run.status, tone: 'neutral' }} />
        <p className="small ml-auto text-muted-foreground">
          {RUN_NAMES[run.stage]} · {ROLE_WORDS[run.role] ?? run.role}
          {run.leasedBy !== null && ` · ${workerOf(run.leasedBy).name}`} · started{' '}
          <Time iso={run.startedAt} />
        </p>
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <RunSteps run={run} />
        <RunAside run={run} admin={admin} />
      </div>
      <AutoRefresh />
    </>
  )
}
