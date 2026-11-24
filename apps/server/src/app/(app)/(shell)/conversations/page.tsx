import { EmptyState } from '../../components/EmptyState'
import { PageTitle } from '../../components/PageTitle'
import { StartConversation } from '../../components/conversation/StartConversation'
import { currentWorkspace } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function ConversationsPage() {
  const { workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="There is no Workspace yet." action={{ href: '/', label: 'Back' }} />
  return (
    <>
      <PageTitle>Conversations</PageTitle>
      <div className="grid gap-4 p-6">
        <h1>Conversations</h1>
        <StartConversation workspace={workspace.id} />
      </div>
    </>
  )
}
