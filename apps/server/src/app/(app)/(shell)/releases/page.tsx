import { releasesPage, type ReleasesView } from '../../../../core/releases/view'
import { isAdmin } from '../../lib/settings-admin'
import { EmptyState } from '../../components/EmptyState'
import { PageTitle } from '../../components/PageTitle'
import { ReleaseSection } from '../../components/releases/ReleaseSection'
import { PastVersions } from '../../components/releases/PastVersions'
import { ProductPicker } from '../../components/releases/ProductPicker'
import { CheckError, ReleasesUnread } from '../../components/releases/ReleasesCheck'
import { ReleaseNotes } from '../../components/releases/ReleaseNotes'
import { ReadyList } from '../../components/releases/ReadyList'
import { ReleasesNow } from '../../components/releases/ReleasesNow'
import { currentWorkspace, payloadClient } from '../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ product?: string; refused?: string }> }

export default async function ReleasesPage({ searchParams }: Props) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const query = await searchParams
  const requested = Number(query.product)
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
      <Body view={view} canCheck={isAdmin(user)} workspace={workspace.id} refused={query.refused} />
    </>
  )
}

type BodyProps = { view: ReleasesView; canCheck: boolean; workspace: number; refused: string | undefined }

function Body({ view, canCheck, workspace, refused }: BodyProps) {
  if (view.product === null) return <EmptyState text="This Workspace has no Product yet." />
  if (view.ready === null) return <ReleasesUnread check={view.check} product={view.product.id} canCheck={canCheck} />
  return (
    <>
      <CheckError check={view.check} />
      <ReleasesNow view={view} />
      <ReadyList ready={view.ready} />
      <ReleaseSection workspace={workspace} view={view} refused={refused} />
      <ReleaseNotes view={view} />
      <PastVersions past={view.past} />
    </>
  )
}
