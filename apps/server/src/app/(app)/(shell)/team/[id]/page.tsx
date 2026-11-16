import Link from 'next/link'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { AgentView } from '../../../components/team/AgentView'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'
import { workflowFor } from '../../../../../lib/factory'
import { loadSession } from '../../../../../lib/sessions'
import { title as stageTitle } from '../../../../../lib/workflow'
import { disconnectSession, releaseSessionLock } from '../actions'

export const dynamic = 'force-dynamic'

export default async function Agent({ params }: { params: Promise<{ id: string }> }) {
  const { id: publicId } = await params
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const admin = isAdmin(user)
  const view = await loadSession(await payloadClient(), workspace.id, publicId, { admin })
  if (!view) {
    return (
      <>
        <PageTitle>Agent</PageTitle>
        <h1 className="title">This agent does not exist.</h1>
        <p className="body"><Link className="text-primary" href="/team">Agent team</Link></p>
      </>
    )
  }
  const wf = workflowFor(workspace.id)
  const role = wf.roles.find((r) => r.id === view.session.role)
  return (
    <>
      <PageTitle>{view.session.label ?? view.session.publicId}</PageTitle>
      <AutoRefresh />
      <AgentView view={view} admin={admin} role={{ title: role?.title ?? view.session.role, avatar: role?.avatar ?? view.session.role }} titles={Object.fromEntries(wf.stages.map((s) => [s.name, stageTitle(wf, s.name)]))} disconnect={disconnectSession} release={releaseSessionLock} />
    </>
  )
}
