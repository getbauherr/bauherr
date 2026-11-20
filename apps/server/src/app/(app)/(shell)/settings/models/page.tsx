import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { BudgetSection, TiersSection } from '../../../components/models/ModelSections'
import { SettingsForm } from '../../../components/SettingsForm'
import { isAdmin, loadWorkspaceSettings } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { saveModels } from '../actions'
import { PricesStatus } from '../../../components/gateway/PricesStatus'
import { GatewayStatus } from '../../../components/gateway/GatewayStatus'
import { loadGatewayStatus, loadPrices } from '../../../lib/gateway-setup'
import { payloadClient } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Models() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const w = await loadWorkspaceSettings(workspace.id)
  const usd = w.budgetUnit === 'usd'
  const payload = await payloadClient()
  const [prices, gateway] = await Promise.all([loadPrices(payload), loadGatewayStatus(payload)])
  return (
    <>
      <h2 className="heading">Models &amp; budget</h2>
      <SettingsForm action={saveModels} submit="Save" primary bar>
        <BudgetSection w={w} usd={usd} />
        <TiersSection w={w} />
      </SettingsForm>
      <PricesStatus prices={prices} admin />
      <section id="gateway" aria-label="Gateway" className="flex flex-col gap-2">
        <h3 className="heading">Gateway</h3>
        <GatewayStatus status={gateway} />
      </section>
    </>
  )
}
