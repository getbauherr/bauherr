import { OpenOnLoad, RequestOpen } from '../../../components/chat/DockOpen'
import { EmptyState } from '../../../components/EmptyState'
import { ownsDraft } from '../../../lib/requests'
import { currentPersonWorkspace, payloadClient } from '../../../lib/session'
import { isBauherr, productsVisibleTo } from '../../../../../lib/people'

export const dynamic = 'force-dynamic'

/** The link people bookmark: it opens the docked chat on a new, empty request. `?session=<id>` (an older draft link) continues that draft of the caller's instead. */
export default async function NewRequest({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const { session } = await searchParams
  const { user, workspace } = await currentPersonWorkspace()
  const payload = await payloadClient()
  const products = workspace ? (await payload.count({ collection: 'products', where: productsVisibleTo(user, workspace.id), overrideAccess: true })).totalDocs : 0
  if (!products) return <><h1 className="title">New request</h1><EmptyState text={`No products in ${workspace?.name ?? 'any Workspace'} yet.${user.role === 'admin' ? '' : isBauherr(user) ? ' Ask an Admin to set up the Workspace.' : ' Ask your Bauherr to assign a Product to you.'}`} action={user.role === 'admin' ? { href: '/setup', label: 'Set up your Workspace' } : undefined} /></>
  const draft = workspace && session && /^\d{1,9}$/.test(session) && (await ownsDraft(user.id as number, workspace.id, Number(session))) ? Number(session) : 'new'
  return (
    <div className="flex flex-col gap-4">
      <h1 className="title">New request</h1>
      <p className="body m-0 max-w-[60ch]">{draft === 'new' ? 'Describe what you need in the chat on the right. I ask a few questions, then you check the request before it is sent.' : 'Your draft is open in the chat on the right.'}</p>
      <RequestOpen request={draft} className="self-start">Open the chat</RequestOpen>
      <p className="small m-0"><a className="text-primary" href="/requests">Your requests</a></p>
      <OpenOnLoad request={draft} />
    </div>
  )
}
