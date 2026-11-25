import { releasesPage } from '../../../../core/releases/view'
import { EmptyState } from '../../components/EmptyState'
import { PageTitle } from '../../components/PageTitle'
import { PastVersions } from '../../components/releases/PastVersions'
import { ProductPicker } from '../../components/releases/ProductPicker'
import { ReadyList } from '../../components/releases/ReadyList'
import { ReleasesNow } from '../../components/releases/ReleasesNow'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ product?: string }> }

export default async function ReleasesPage({ searchParams }: Props) {
  const { workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const requested = Number((await searchParams).product)
  const view = await releasesPage(await payloadClient(), {
    workspace: workspace.id,
    product: Number.isInteger(requested) && requested > 0 ? requested : undefined,
  })
  return (
    <>
      <PageTitle>Releases</PageTitle>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="title">Releases</h1>
        <ProductPicker products={view.products} product={view.product?.id ?? null} />
      </div>
      {view.product === null && <EmptyState text="This Workspace has no Product yet." />}
      {view.product !== null && view.ready === null && (
        <EmptyState text="The repository has not been read yet. Releases appear after the next readiness check." />
      )}
      {view.ready !== null && (
        <>
          <ReleasesNow view={view} />
          <ReadyList ready={view.ready} />
          <PastVersions past={view.past} />
        </>
      )}
    </>
  )
}
