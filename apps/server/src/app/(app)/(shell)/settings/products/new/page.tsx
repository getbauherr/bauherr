import { EmptyState } from '../../../../components/EmptyState'
import { Field, SettingsForm } from '../../../../components/SettingsForm'
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
        <Field name="name" label="Product name" hint="What you call this product on the Board and in Tickets." example="Acme Shop" required />
        <details className="advanced">
          <summary className="small">Advanced</summary>
          <div className="mt-3">
            <Field name="slug" label="Short name" hint="Used in links and in the Knowledge repo folder products/<short name>/. Empty: derived from the name." example="acme-shop" />
          </div>
        </details>
      </SettingsForm>
    </SettingsSection>
  )
}
