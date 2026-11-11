import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { WorkflowEditor } from '../../../components/workflow-editor/WorkflowEditor'
import { currentWorkspace } from '../../../lib/session'
import { isAdmin } from '../../../lib/settings'
import { loadEditor } from '../../../lib/workflow-editor'

export const dynamic = 'force-dynamic'

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const tab = (await searchParams).tab
  return <WorkflowEditor key={workspace.id} data={await loadEditor(workspace)} initialTab={tab === 'yaml' || tab === 'history' ? tab : 'design'} />
}
