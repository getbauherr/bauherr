import { AssignmentFields } from '../../../components/AssignmentFields'
import { EditDrawer } from '../../../components/EditDrawer'
import { EmptyState } from '../../../components/EmptyState'
import { Checks, Field, SettingsForm } from '../../../components/SettingsForm'
import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import { Table } from '../../../components/ui/table'
import { assignmentWords } from '../../../../../lib/people'
import { isAdmin, loadAssignable, loadBauherren } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { changeRole, createBauherr, createProductOwner, removeDoc, saveAssignment, saveBauherr, unlockBauherr } from '../actions'

export const dynamic = 'force-dynamic'

const LABEL: Record<string, string> = { admin: 'Admin', bauherr: 'Bauherr', 'product-owner': 'Product owner' }
const ROLES: [string, string][] = [['bauherr', LABEL.bauherr!], ['admin', LABEL.admin!]]

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
      <Table>
          <thead><tr className="label"><th>Email</th><th>Role</th><th>Access</th><th>Forge login</th><th>SSO</th>{admin && <th><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {bauherren.map((b) => {
              const owner = b.role === 'product-owner'
              return (
              <tr key={b.id}>
                <td>{b.email}{b.locked && <> <Badge variant="destructive">Locked</Badge></>}</td>
                <td>{LABEL[b.role] ?? b.role}</td>
                <td>{owner ? assignmentWords(b.assignments.map((a) => ({ workspace: a.workspace.name, scope: a.scope, products: a.products.map((p) => p.name) }))) : b.workspaces.map((w) => w.name).join(', ')}</td>
                <td>{b.githubLogin ? `@${b.githubLogin}` : <span className="text-warn" title="A label or comment from this person on the forge does not count until they link their login">not linked</span>}</td>
                <td>{b.oidcLinked ? 'linked' : <span className="text-muted-foreground">—</span>}</td>
                {admin && (
                  <td>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                      <EditDrawer>
                          {owner ? (
                            <>
                              <SettingsForm action={saveAssignment}>
                                <input type="hidden" name="id" value={b.id} />
                                <AssignmentFields workspaces={assignable} workspace={b.assignments[0]?.workspace.id} scope={b.assignments[0]?.scope} products={b.assignments[0]?.products.map((p) => p.id)} removable />
                              </SettingsForm>
                              <SettingsForm action={saveBauherr}>
                                <input type="hidden" name="id" value={b.id} />
                                <Field name="githubLogin" label="GitHub login" hint="Links the forge account of this person: their labels and comments there then count as their decision." example="sbuckpesch" defaultValue={b.githubLogin} />
                                <Field name="oidcSubject" label="SSO subject" defaultValue={b.oidcSubject} hint="<issuer>|<user ID>. In Keycloak the ID is under Users, the user, ID." />
                              </SettingsForm>
                            </>
                          ) : (
                          <SettingsForm action={saveBauherr}>
                            <input type="hidden" name="id" value={b.id} />
                            <Field name="role" label="Role" options={ROLES} defaultValue={b.role} />
                            <Checks name="workspaces" items={items} checked={b.workspaces.map((w) => w.id)} />
                            <Field name="githubLogin" label="GitHub login" hint="Links the forge account of this person: their labels and comments there count as their decision, and they are assigned and mentioned when a Ticket needs their approval." example="sbuckpesch" defaultValue={b.githubLogin} />
                            <Field name="oidcSubject" label="SSO subject" defaultValue={b.oidcSubject} hint="<issuer>|<user ID>. In Keycloak the ID is under Users, the user, ID." />
                          </SettingsForm>
                          )}
                          {b.role !== 'admin' && b.id !== user.id && (
                            <SettingsForm key={b.role} action={changeRole} submit={owner ? 'Make Bauherr' : 'Make Product owner'} confirm={owner ? 'Confirm: sees the whole Workspace' : 'Confirm: loses access to everything but their profile'}>
                              <input type="hidden" name="id" value={b.id} />
                              <input type="hidden" name="from" value={b.role} />
                              <input type="hidden" name="role" value={owner ? 'bauherr' : 'product-owner'} />
                              <p className="small text-muted-foreground">{owner ? 'A Bauherr sees everything in the Workspaces below. Set them under Workspaces after the change.' : 'A Product owner has no access until you assign Products.'}</p>
                            </SettingsForm>
                          )}
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
              )
            })}
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
      {admin && !!assignable.length && (
        <Card asChild className="gap-4"><section>
          <h2 className="heading">Add Product owner</h2>
          <p className="small text-muted-foreground">Signs in and sees only the Products assigned here. A temporary password is shown once.</p>
          <SettingsForm action={createProductOwner} submit="Add Product owner" reset>
            <Field name="email" label="Email" type="email" required />
            <AssignmentFields workspaces={assignable} workspace={workspace?.id} />
          </SettingsForm>
        </section></Card>
      )}
    </>
  )
}
