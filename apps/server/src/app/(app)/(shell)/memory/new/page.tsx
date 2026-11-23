import { notFound } from 'next/navigation'
import { memoryProducts } from '../../../../../core/views/statement-records'
import { EmptyState } from '../../../components/EmptyState'
import { AddMemoryForm } from '../../../components/memory/AddMemoryForm'
import { PageTitle } from '../../../components/PageTitle'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function NewMemoryPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const { workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const products = await memoryProducts(await payloadClient(), workspace.id)
  const first = products[0]
  if (!first) return <EmptyState text="Add a Product first: memory belongs to a Product." />
  const { product } = await searchParams
  const asked = product === undefined ? first : products.find((entry) => entry.id === Number(product))
  if (!asked) notFound()
  return (
    <>
      <PageTitle>Add a memory</PageTitle>
      <div className="max-w-2xl">
        <AddMemoryForm products={products} product={asked.id} />
      </div>
    </>
  )
}
