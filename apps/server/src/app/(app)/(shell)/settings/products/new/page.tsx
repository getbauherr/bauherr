import { EmptyState } from '../../../../components/EmptyState'
import { NewProductForm } from '../../../../components/NewProductForm'
import { SettingsSection } from '../../../../components/SettingsParts'
import { isAdmin, loadProducts } from '../../../../lib/settings'
import { currentWorkspace } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function NewProduct() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  if (!isAdmin(user)) return <EmptyState text="Ask an Admin to add one." />
  const { connections } = await loadProducts(workspace.id)
  if (!connections.length) return <EmptyState text="Bauherr needs access to GitHub or GitLab first." action={{ href: '/settings/connections', label: 'Add connection' }} />
  return (
    <SettingsSection id="new" title="Add Product" purpose="Name it and point it at its repository; new issues become Tickets.">
      <NewProductForm connections={connections} />
    </SettingsSection>
  )
}
