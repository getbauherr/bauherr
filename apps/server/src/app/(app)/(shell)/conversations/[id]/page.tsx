import { conversationWorkspace, listMessages } from '../../../../../core/conversations/store'
import { ConversationView } from '../../../components/conversation/ConversationView'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

const GONE = { href: '/conversations', label: 'Back to Conversations' }

export default async function ConversationPage({ params }: Props) {
  const { workspace } = await currentWorkspace()
  const id = Number((await params).id)
  const payload = await payloadClient()
  const owned = Number.isInteger(id) && id > 0 && (await conversationWorkspace(payload, id)) === workspace?.id
  if (!owned) return <EmptyState text="This conversation does not exist." action={GONE} />
  return (
    <>
      <PageTitle>{`Conversation ${id}`}</PageTitle>
      <div className="mx-auto flex h-[calc(100dvh-8rem)] w-full max-w-3xl flex-col gap-4 p-6">
        <h1>{`Conversation ${id}`}</h1>
        <ConversationView conversationId={id} initial={await listMessages(payload, id)} />
      </div>
    </>
  )
}
