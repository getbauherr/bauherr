import Link from 'next/link'
import { notFound } from 'next/navigation'
import { forgeCheckNames, productSettings } from '../../../../../../core/views/product-settings'
import { ticketsMessage, blockedBy, recordCountOf } from '../../../../../../lib/settings-guards'
import { EmptyState } from '../../../../components/EmptyState'
import { PageTitle } from '../../../../components/PageTitle'
import { GatesSection } from '../../../../components/product/GatesSection'
import { IntakeSection } from '../../../../components/product/IntakeSection'
import { ProofSection } from '../../../../components/product/ProofSection'
import { RemoveDoc } from '../../../../components/product/RemoveDoc'
import { RepositorySection } from '../../../../components/product/RepositorySection'
import { SettingsSection } from '../../../../components/SettingsParts'
import { gitConnections } from '../../../../lib/git-connections'
import { currentWorkspace, payloadClient } from '../../../../lib/session'
import { isAdmin } from '../../../../lib/settings'

export const dynamic = 'force-dynamic'

async function DangerZone({ product }: { product: number }) {
  const payload = await payloadClient()
  const tickets = await recordCountOf(payload, product)
  const blocked = await blockedBy(payload, 'products', product)
  return (
    <SettingsSection id="danger" title="Delete Product">
      {tickets > 0 ? (
        <p className="small text-muted-foreground">{ticketsMessage(tickets)}</p>
      ) : blocked ? (
        <p className="small text-muted-foreground">Cannot delete yet: still referenced by {blocked}. Remove those first.</p>
      ) : (
        <>
          <p className="small text-muted-foreground">Permanently deletes this Product. It must have nothing attached: no repositories or ticket sources.</p>
          <RemoveDoc collection="products" id={product} label="Delete Product" />
        </>
      )}
    </SettingsSection>
  )
}

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, product: id }
  const product = await productSettings(payload, filter)
  if (!product) notFound()
  const admin = isAdmin(user)
  return (
    <div data-wide className="flex max-w-5xl flex-col gap-4">
      <PageTitle>{product.name}</PageTitle>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="small text-muted-foreground"><Link href="/settings/products">Products</Link> / {product.name}</p>
        <h2 className="title">{product.name}</h2>
      </div>
      {!admin && <p className="small text-muted-foreground">Only an Admin can change Product settings.</p>}
      <div className="grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-4">
          <RepositorySection product={product} connections={await gitConnections(payload, workspace.id)} admin={admin} />
          <IntakeSection product={product} admin={admin} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <GatesSection product={product} admin={admin} />
          <ProofSection product={product} forgeChecks={await forgeCheckNames(payload, filter)} admin={admin} />
        </div>
      </div>
      {admin && <DangerZone product={product.id} />}
    </div>
  )
}
