import { EditDrawer } from '../../../components/EditDrawer'
import { EmptyState } from '../../../components/EmptyState'
import { Checks, Field, SettingsForm } from '../../../components/SettingsForm'
import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import { Table } from '../../../components/ui/table'
import { isAdmin, loadBauherren } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { createBauherr, removeDoc, saveBauherr, unlockBauherr } from '../actions'

export const dynamic = 'force-dynamic'

const ROLES = ['bauherr', 'admin']

export default async function BauherrenSettings() {
  const { user, workspace, workspaces } = await currentWorkspace()
  const admin = isAdmin(user)
  const bauherren = await loadBauherren(user, workspace?.id ?? null)
  const items = workspaces.map((w) => ({ id: w.id, label: w.name }))
  return (
    <>
      {!bauherren.length && <EmptyState text="No Bauherren yet." />}
      <Table>
          <thead><tr className="label"><th>Email</th><th>Role</th><th>Workspaces</th><th>SSO</th>{admin && <th />}</tr></thead>
          <tbody>
            {bauherren.map((b) => (
              <tr key={b.id}>
                <td>{b.email}{b.locked && <> <Badge variant="destructive">Locked</Badge></>}</td>
                <td>{b.role}</td>
                <td>{b.workspaces.map((w) => w.name).join(', ')}</td>
                <td>{b.oidcLinked ? 'linked' : <span className="text-muted-foreground">—</span>}</td>
                {admin && (
                  <td>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                      <EditDrawer>
                          <SettingsForm action={saveBauherr}>
                            <input type="hidden" name="id" value={b.id} />
                            <Field name="role" label="Role" options={ROLES} defaultValue={b.role} />
                            <Checks name="workspaces" items={items} checked={b.workspaces.map((w) => w.id)} />
                            <Field name="githubLogin" label="GitHub login" hint="Used to assign and mention you when a Ticket needs your approval." example="sbuckpesch" defaultValue={b.githubLogin} />
                            <Field name="oidcSubject" label="SSO subject" defaultValue={b.oidcSubject} hint="<issuer>|<user ID>. In Keycloak the ID is under Users, the user, ID." />
                          </SettingsForm>
                      </EditDrawer>
                      {b.locked && (
                        <SettingsForm action={unlockBauherr} submit="Unlock" inline>
                          <input type="hidden" name="id" value={b.id} />
                        </SettingsForm>
                      )}
                      {b.id !== user.id && (
                        <SettingsForm action={removeDoc} submit="Remove" confirm="Confirm remove" inline>
                          <input type="hidden" name="collection" value="bauherren" />
                          <input type="hidden" name="id" value={b.id} />
                        </SettingsForm>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
      </Table>
      {admin && (
        <Card asChild className="gap-4"><section>
          <h2 className="heading">Add Bauherr</h2>
          <SettingsForm action={createBauherr} submit="Add Bauherr" reset primary>
            <Field name="email" label="Email" type="email" required />
            <Field name="role" label="Role" options={ROLES} defaultValue="bauherr" />
            <Checks name="workspaces" items={items} checked={workspace ? [workspace.id] : []} />
          </SettingsForm>
        </section></Card>
      )}
    </>
  )
}
