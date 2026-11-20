import { changeRole, removeDoc, saveAssignment, saveBauherr, unlockBauherr } from '../../(shell)/settings/actions'
import { AssignmentFields } from '../AssignmentFields'
import { EditDrawer } from '../EditDrawer'
import { Checks, Field, SettingsForm } from '../SettingsForm'
import { ROLES } from './labels'
import type { Assignable, Person, WorkspaceItem } from './types'

const SSO_HINT = '<issuer>|<user ID>. In Keycloak the ID is under Users, the user, ID.'

function OwnerForms({ b, assignable }: { b: Person; assignable: Assignable }) {
  return (
    <>
      <SettingsForm action={saveAssignment}>
        <input type="hidden" name="id" value={b.id} />
        <AssignmentFields
          workspaces={assignable}
          workspace={b.assignments[0]?.workspace.id}
          scope={b.assignments[0]?.scope}
          products={b.assignments[0]?.products.map((p) => p.id)}
          removable
        />
      </SettingsForm>
      <SettingsForm action={saveBauherr}>
        <input type="hidden" name="id" value={b.id} />
        <Field
          name="githubLogin"
          label="GitHub login"
          hint={
            'Links the forge account of this person: their labels and comments there then ' + 'count as their decision.'
          }
          example="sbuckpesch"
          defaultValue={b.githubLogin}
        />
        <Field name="oidcSubject" label="SSO subject" defaultValue={b.oidcSubject} hint={SSO_HINT} />
      </SettingsForm>
    </>
  )
}

function MemberForm({ b, items }: { b: Person; items: WorkspaceItem[] }) {
  return (
    <SettingsForm action={saveBauherr}>
      <input type="hidden" name="id" value={b.id} />
      <Field name="role" label="Role" options={ROLES} defaultValue={b.role} />
      <Checks name="workspaces" items={items} checked={b.workspaces.map((w) => w.id)} />
      <Field
        name="githubLogin"
        label="GitHub login"
        hint={
          'Links the forge account of this person: their labels and comments there count ' +
          'as their decision, and they are assigned and mentioned when a Ticket needs ' +
          'their approval.'
        }
        example="sbuckpesch"
        defaultValue={b.githubLogin}
      />
      <Field name="oidcSubject" label="SSO subject" defaultValue={b.oidcSubject} hint={SSO_HINT} />
    </SettingsForm>
  )
}

function RoleChangeForm({ b, owner }: { b: Person; owner: boolean }) {
  return (
    <SettingsForm
      key={b.role}
      action={changeRole}
      submit={owner ? 'Make Bauherr' : 'Make Product owner'}
      confirm={owner ? 'Confirm: sees the whole Workspace' : 'Confirm: loses access to everything but their profile'}
    >
      <input type="hidden" name="id" value={b.id} />
      <input type="hidden" name="from" value={b.role} />
      <input type="hidden" name="role" value={owner ? 'bauherr' : 'product-owner'} />
      <p className="small text-muted-foreground">
        {owner
          ? 'A Bauherr sees everything in the Workspaces below. Set them under Workspaces after the change.'
          : 'A Product owner has no access until you assign Products.'}
      </p>
    </SettingsForm>
  )
}

export function PersonActions({
  b,
  userId,
  assignable,
  items,
}: {
  b: Person
  userId: number | string
  assignable: Assignable
  items: WorkspaceItem[]
}) {
  const owner = b.role === 'product-owner'
  return (
    <div className="flex flex-wrap items-center justify-start gap-3">
      <EditDrawer>
        {owner ? <OwnerForms b={b} assignable={assignable} /> : <MemberForm b={b} items={items} />}
        {b.role !== 'admin' && b.id !== userId && <RoleChangeForm b={b} owner={owner} />}
      </EditDrawer>
      {b.locked && (
        <SettingsForm action={unlockBauherr} submit="Unlock" inline>
          <input type="hidden" name="id" value={b.id} />
        </SettingsForm>
      )}
      {b.id !== userId && (
        <SettingsForm action={removeDoc} submit="Remove" confirm="Confirm remove" inline>
          <input type="hidden" name="collection" value="bauherren" />
          <input type="hidden" name="id" value={b.id} />
        </SettingsForm>
      )}
    </div>
  )
}
