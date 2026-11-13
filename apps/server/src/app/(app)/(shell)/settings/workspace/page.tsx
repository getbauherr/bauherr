import { EmptyState } from '../../../components/EmptyState'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { ToggleRow } from '../../../components/SettingsParts'
import { LegacyAnchors } from '../../../components/LegacyAnchors'
import { Table } from '../../../components/ui/table'
import { isAdmin, loadWorkspaceSettings } from '../../../lib/settings'
import { DeleteWorkspace } from '../../../components/DeleteWorkspace'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { archivedWorkspaces, deleteImpact, RESTORE_DAYS } from '../../../../../lib/workspace-delete'
import { createWorkspace, restoreWorkspaceAction, rotateWorkspaceKey, saveGeneral } from '../actions'

export const dynamic = 'force-dynamic'

const SECTION = 'flex flex-col gap-4'
const PAIR = 'grid grid-cols-2 gap-4 max-sm:grid-cols-1'

const NewWorkspace = () => (
  <section id="new-workspace" className={SECTION}>
    <h2 className="heading">New Workspace</h2>
    <SettingsForm action={createWorkspace} submit="Create Workspace" reset>
      <div className={PAIR}>
        <Field name="name" label="Name" required />
        <Field name="slug" label="Slug" hint="Lowercase letters, digits and dashes; defaults to the name." />
      </div>
    </SettingsForm>
  </section>
)

const Archived = ({ list }: { list: Awaited<ReturnType<typeof archivedWorkspaces>> }) =>
  list.length > 0 && (
    <section id="archived" className={SECTION}>
      <h2 className="heading">Archived Workspaces</h2>
      <p className="small text-muted-foreground">Restorable until the date shown. Keys are not restored: mint new ones after restoring.</p>
      <Table>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <th>{a.name}</th>
              <td>Restorable until {new Date(a.purgeAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</td>
              <td><SettingsForm action={restoreWorkspaceAction} submit="Restore" inline><input type="hidden" name="id" value={a.id} /></SettingsForm></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )

export default async function WorkspaceSettings() {
  const { user, workspace } = await currentWorkspace()
  const archived = isAdmin(user) ? await archivedWorkspaces(await payloadClient()) : []
  if (!workspace) return (
    <>
      <EmptyState text="You have no Workspace yet." />
      {isAdmin(user) && <NewWorkspace />}
      <Archived list={archived} />
    </>
  )
  const w = await loadWorkspaceSettings(workspace.id)
  const admin = isAdmin(user)
  return (
    <>
      <LegacyAnchors />
      <h2 className="heading">General</h2>
      {admin ? (
        <SettingsForm action={saveGeneral} submit="Save" primary>
          <Field name="name" label="Name" defaultValue={w.name} />
          <ToggleRow name="progressComments" label="Post progress on the issue in plain words" help="One Comment on each issue, edited as the request moves, plus a short mention of the author when a question is open, a change is ready on staging, it is released or stuck. The texts are in Settings > Templates." defaultChecked={w.progressComments} />
        </SettingsForm>
      ) : (
        <Table><tbody><tr><th>Name</th><td>{w.name}</td></tr></tbody></Table>
      )}
      {admin && <NewWorkspace />}
      <Archived list={archived} />
      {admin && (
        <section id="gateway" className={SECTION}>
          <h2 className="heading">Gateway key</h2>
          {!w.gatewayOn ? (
            <p className="small text-muted-foreground">Gateway off: there is no key to rotate.</p>
          ) : (
            <SettingsForm action={rotateWorkspaceKey} submit="Rotate key" confirm="Confirm rotate" inline>
              <p className="small text-muted-foreground">Issues a new consumer key at the gateway and invalidates the old one.</p>
            </SettingsForm>
          )}
        </section>
      )}
      {admin && (
        <section id="delete-workspace" className={SECTION}>
          <h2 className="heading">Delete workspace</h2>
          <p className="small text-muted-foreground">Archives this Workspace: its work stops, its keys are revoked and it is hidden everywhere. An Admin can restore it for {RESTORE_DAYS} days.</p>
          <div><DeleteWorkspace name={w.name} impact={await deleteImpact(await payloadClient(), workspace.id)} until={new Date(Date.now() + RESTORE_DAYS * 86_400_000).toLocaleDateString('en-GB', { dateStyle: 'medium' })} /></div>
        </section>
      )}
    </>
  )
}
