import { notFound, redirect } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { ownsDraft } from '../../../lib/requests'
import { currentPersonWorkspace, payloadClient } from '../../../lib/session'
import { isBauherr, productsVisibleTo } from '../../../../../lib/people'
import { startDraft } from '../../../../../lib/request-conversation'

export const dynamic = 'force-dynamic'

/** The link people bookmark: it opens the conversation on their empty draft (one they left is reused, so this never piles up drafts). `?session=<id>` (an older draft link) opens that draft of theirs, `?product=<id>` starts for that Product. */
export default async function NewRequest({ searchParams }: { searchParams: Promise<{ session?: string; product?: string }> }) {
  const { session, product } = await searchParams
  const { user, workspace } = await currentPersonWorkspace()
  if (!workspace) notFound()
  if (session && /^\d{1,9}$/.test(session) && (await ownsDraft(user.id as number, workspace.id, Number(session)))) redirect(`/requests/${session}`)
  const payload = await payloadClient()
  const products = (await payload.count({ collection: 'products', where: productsVisibleTo(user, workspace.id), overrideAccess: true })).totalDocs
  if (!products) return <><h1 className="title">New request</h1><EmptyState text={`No products in ${workspace.name} yet.${isBauherr(user) ? ' Set up the Workspace first.' : ' Ask your Bauherr to assign one to you.'}`} action={isBauherr(user) ? { href: '/setup', label: 'Set up your Workspace' } : undefined} /></>
  let id: number | null
  try {
    id = await startDraft({ payload, user, workspace: workspace.id }, /^\d{1,9}$/.test(product ?? '') ? Number(product) : undefined)
  } catch (e) {
    return <><h1 className="title">New request</h1><p role="alert" className="text-destructive">{e instanceof Error ? e.message : 'The request could not be started.'}</p></>
  }
  if (id === null) notFound()
  redirect(`/requests/${id}`)
}
