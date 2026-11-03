import { EmptyState } from '../../../../components/EmptyState'
import { ProductNameFields } from '../../../../components/ProductForms'
import { SettingsForm } from '../../../../components/SettingsForm'
import { SettingsSection } from '../../../../components/SettingsParts'
import { isAdmin } from '../../../../lib/settings'
import { currentWorkspace } from '../../../../lib/session'
import { createProduct } from '../../actions'

export const dynamic = 'force-dynamic'

export default async function NewProduct() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  if (!isAdmin(user)) return <EmptyState text="Ask an Admin to add one." />
  return (
    <SettingsSection id="new" title="Add Product" purpose="Name it, then add its repository on the next page.">
      <SettingsForm action={createProduct} submit="Add Product" primary>
        <ProductNameFields />
      </SettingsForm>
    </SettingsSection>
  )
}
