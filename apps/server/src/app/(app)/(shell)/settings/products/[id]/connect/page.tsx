import Link from 'next/link'
import { notFound } from 'next/navigation'
import { firstLook } from '../../../../../../../core/views/first-look'
import { productSettings } from '../../../../../../../core/views/product-settings'
import { AutoRefresh } from '../../../../../components/AutoRefresh'
import { ConnectSteps } from '../../../../../components/connect/ConnectSteps'
import { FirstLookTables } from '../../../../../components/connect/FirstLookTables'
import { RepositoryOffers } from '../../../../../components/connect/RepositoryOffers'
import { RiskAreaList } from '../../../../../components/connect/RiskAreaList'
import { SwitchOnBar } from '../../../../../components/connect/SwitchOnBar'
import { EmptyState } from '../../../../../components/EmptyState'
import { PageTitle } from '../../../../../components/PageTitle'
import { Badge } from '../../../../../components/ui/badge'
import { Card } from '../../../../../components/ui/card'
import { phaseOf } from '../../../../../lib/connect-phase'
import { currentWorkspace, payloadClient } from '../../../../../lib/session'
import { isAdmin } from '../../../../../lib/settings'

export const dynamic = 'force-dynamic'

const NOTE = 'The import is still running, so these counts are not final yet.'

export default async function ConnectPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()
  const payload = await payloadClient()
  const filter = { workspace: workspace.id, product: id }
  const product = await productSettings(payload, filter)
  if (!product) notFound()
  const look = await firstLook(payload, { ...filter, now: new Date() })
  const { syncCompleted } = look.repository
  const phase = phaseOf({ sources: product.sources.length, syncCompleted, active: product.state === 'active' })
  const admin = isAdmin(user)
  return (
    <div className="flex flex-col gap-4">
      <PageTitle>{`Connect ${product.name}`}</PageTitle>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="small text-muted-foreground">
          <Link href="/settings/products">Products</Link> /{' '}
          <Link href={`/settings/products/${id}`}>{product.name}</Link>
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="title">Connect {product.name}</h2>
          <Badge variant={product.state === 'active' ? 'ok' : 'neutral'}>
            {product.state === 'active' ? 'Active' : 'Observing'}
          </Badge>
        </div>
      </div>
      <ConnectSteps product={product} look={look} phase={phase} />
      {phase === 1 ? (
        <EmptyState
          text="This Product has no repository yet. Add one to import its issues and pull requests."
          action={{ href: `/settings/products/${id}#repository`, label: 'Add a repository' }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <Card className="gap-0 p-0">
            <div className="flex flex-col gap-6 p-6">
              {!syncCompleted && <p role="status" className="small text-warn">{NOTE}</p>}
              <FirstLookTables look={look} />
            </div>
            <SwitchOnBar product={product} admin={admin} />
          </Card>
          <div className="flex flex-col gap-4">
            <RepositoryOffers repository={look.repository} product={product.id} admin={admin} />
            <RiskAreaList product={product} />
          </div>
        </div>
      )}
      {phase === 2 && <AutoRefresh />}
    </div>
  )
}
