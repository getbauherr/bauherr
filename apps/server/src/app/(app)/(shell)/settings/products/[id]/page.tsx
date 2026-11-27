import Link from 'next/link'
import { notFound } from 'next/navigation'
import { alertState } from '../../../../../../core/alerts/store'
import { readiness } from '../../../../../../core/readiness/view'
import { forgeCheckNames, productSettings } from '../../../../../../core/views/product-settings'
import { ticketsMessage, blockedBy, recordCountOf } from '../../../../../../lib/settings-guards'
import { EmptyState } from '../../../../components/EmptyState'
import { PageTitle } from '../../../../components/PageTitle'
import { AlertsSection } from '../../../../components/product/AlertsSection'
import { GatesSection } from '../../../../components/product/GatesSection'
import { IntakeSection } from '../../../../components/product/IntakeSection'
import { ProofSection } from '../../../../components/product/ProofSection'
import { ReadinessSection } from '../../../../components/product/ReadinessSection'
import { ReleasesSection } from '../../../../components/product/ReleasesSection'
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
        <p className="small text-muted-foreground">
          Cannot delete yet: still referenced by {blocked}. Remove those first.
        </p>
      ) : (
        <>
          <p className="small text-muted-foreground">
            Permanently deletes this Product. It must have nothing attached: no repositories or ticket sources.
          </p>
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
  const ready = await readiness(payload, { ...filter, now: new Date() })
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{product.name}</PageTitle>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="small text-muted-foreground">
          <Link href="/settings/products">Products</Link> / {product.name}
        </p>
        <h2 className="title">{product.name}</h2>
      </div>
      {!admin && <p className="small text-muted-foreground">Only an Admin can change Product settings.</p>}
      {ready && <ReadinessSection product={product.id} view={ready} admin={admin} />}
      {ready && <ReleasesSection product={product} view={ready} admin={admin} />}
      <RepositorySection product={product} connections={await gitConnections(payload, workspace.id)} admin={admin} />
      <IntakeSection product={product} admin={admin} />
      <GatesSection product={product} admin={admin} />
      <AlertsSection product={product.id} state={await alertState(payload, filter)} admin={admin} />
      <ProofSection product={product} forgeChecks={await forgeCheckNames(payload, filter)} admin={admin} />
      <p className="small text-muted-foreground">
        What the factory remembers for this Product is on the{' '}
        <Link href={`/memory?product=${product.id}`} className="text-primary hover:underline">
          Memory page
        </Link>
        .
      </p>
      {admin && <DangerZone product={product.id} />}
    </div>
  )
}
