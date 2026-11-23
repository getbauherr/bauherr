import { RunNotFound } from '../../../../../core/run/errors'
import { runPage } from '../../../../../core/views/run'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { RunAside } from '../../../components/ticket/RunAside'
import { RunHeader } from '../../../components/ticket/RunHeader'
import { RunSteps } from '../../../components/ticket/RunSteps'
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
  return (
    <>
      <PageTitle>{`Run ${run.id}`}</PageTitle>
      <RunHeader run={run} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <RunSteps run={run} />
        <RunAside run={run} admin={admin} />
      </div>
      <AutoRefresh />
    </>
  )
}
