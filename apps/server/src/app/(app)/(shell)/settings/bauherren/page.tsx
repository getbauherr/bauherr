import { AssignmentFields } from '../../../components/AssignmentFields'
import { EmptyState } from '../../../components/EmptyState'
import { ROLES } from '../../../components/people/labels'
import { PeopleTable } from '../../../components/people/PeopleTable'
import { Checks, Field, SettingsForm } from '../../../components/SettingsForm'
import { Card } from '../../../components/ui/card'
import { isAdmin, loadAssignable, loadBauherren } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { createBauherr, createProductOwner } from '../actions'

export const dynamic = 'force-dynamic'

export default async function BauherrenSettings() {
  const { user, workspace, workspaces } = await currentWorkspace()
  const admin = isAdmin(user)
  const bauherren = await loadBauherren(user, workspace?.id ?? null)
  const items = workspaces.map((w) => ({ id: w.id, label: w.name }))
  const assignable = admin ? await loadAssignable(workspaces) : []
  return (
    <>
      <h2 className="heading">People</h2>
      {!bauherren.length && <EmptyState text="No people yet." />}
      <PeopleTable people={bauherren} admin={admin} userId={user.id} assignable={assignable} items={items} />
      {admin && (
        <Card asChild className="gap-4">
          <section>
            <h2 className="heading">Add Bauherr</h2>
            <SettingsForm action={createBauherr} submit="Add Bauherr" reset primary>
              <Field name="email" label="Email" type="email" required />
              <Field name="role" label="Role" options={ROLES} defaultValue="bauherr" />
              <Checks name="workspaces" items={items} checked={workspace ? [workspace.id] : []} />
            </SettingsForm>
          </section>
        </Card>
      )}
      {admin && !!assignable.length && (
        <Card asChild className="gap-4">
          <section>
            <h2 className="heading">Add Product owner</h2>
            <p className="small text-muted-foreground">
              Signs in and sees only the Products assigned here. A temporary password is shown once.
            </p>
            <SettingsForm action={createProductOwner} submit="Add Product owner" reset>
              <Field name="email" label="Email" type="email" required />
              <AssignmentFields workspaces={assignable} workspace={workspace?.id} />
            </SettingsForm>
          </section>
        </Card>
      )}
    </>
  )
}
