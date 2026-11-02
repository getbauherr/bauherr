import { IntakeChat } from '../../../components/IntakeChat'
import { EmptyState } from '../../../components/EmptyState'
import { currentWorkspace, payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function NewRequest() {
  const { workspace } = await currentWorkspace()
  const products = workspace
    ? (await (await payloadClient()).find({ collection: 'products', where: { workspace: { equals: workspace.id } }, sort: 'name', pagination: false, depth: 0, overrideAccess: true })).docs.map((p) => ({ id: p.id as number, name: p.name as string }))
    : []
  return (
    <>
      <h1 className="title">New request</h1>
      {products.length ? <IntakeChat products={products} /> : <EmptyState text={`No products in ${workspace?.name ?? 'any Workspace'} yet.`} action={{ href: '/settings/workspace', label: 'Open settings' }} />}
    </>
  )
}
