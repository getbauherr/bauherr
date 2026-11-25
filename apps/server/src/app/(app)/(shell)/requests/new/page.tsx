import type { Payload } from 'payload'
import type { Person } from '../../../lib/session'
import { listMessages } from '../../../../../core/conversations/store'
import { loadDraft } from '../../../../../core/requests/store'
import { draftView } from '../../../../../core/requests/view'
import { mayOpenRequest } from '../../../../../core/views/request-access'
import { memoryProducts } from '../../../../../core/views/memory-products'
import { EmptyState } from '../../../components/EmptyState'
import { PageTitle } from '../../../components/PageTitle'
import { NewRequest } from '../../../components/request/NewRequest'
import { currentPersonWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ product?: string; draft?: string }> }

const resume = async (payload: Payload, person: Person, workspace: number, draft: string | undefined) => {
  const id = Number(draft)
  if (!Number.isInteger(id)) return null
  const found = await loadDraft(payload, id)
  if (!found || found.workspace !== workspace) return null
  if (!mayOpenRequest(person, { workspace, product: found.product })) return null
  return { id, messages: await listMessages(payload, id), draft: await draftView(payload, id) }
}

export default async function NewRequestPage({ searchParams }: Props) {
  const { user, workspace } = await currentPersonWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const products = (await memoryProducts(payload, workspace.id))
    .filter(({ id }) => mayOpenRequest(user, { workspace: workspace.id, product: id }))
    .map(({ id, name }) => ({ id, name }))
  const first = products[0]
  if (!first) return <EmptyState text="Add a Product first: a request belongs to a Product." />
  const { product, draft } = await searchParams
  const resumed = await resume(payload, user, workspace.id, draft)
  const asked = products.find((entry) => entry.id === Number(product)) ?? first
  return (
    <>
      <PageTitle>New request</PageTitle>
      <div className="mx-auto grid w-full max-w-6xl gap-4 p-6">
        <h1 className="heading m-0">New request</h1>
        <NewRequest workspace={workspace.id} products={products} product={asked.id} initial={resumed} />
      </div>
    </>
  )
}
