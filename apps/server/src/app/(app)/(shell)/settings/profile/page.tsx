import { Table } from '../../../components/ui/table'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { ThemePicker } from '../../../components/ThemeToggle'
import { saveOwnLogin } from './actions'
import { requireBauherr, workspacesOf } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const ROLE = { admin: 'Admin', bauherr: 'Bauherr' } as const

export default async function Profile() {
  const user = await requireBauherr()
  const workspaces = await workspacesOf(user)
  const login = (user as { githubLogin?: string | null }).githubLogin
  return (
    <>
      <h2 className="heading">Profile</h2>
      <Table>
        <tbody>
          <tr>
            <th>Email</th>
            <td>{user.email}</td>
          </tr>
          <tr>
            <th>Role</th>
            <td>{ROLE[user.role]}</td>
          </tr>
          <tr>
            <th>Workspaces</th>
            <td>{workspaces.map((w) => w.name).join(', ') || <span className="text-muted-foreground">None</span>}</td>
          </tr>
        </tbody>
      </Table>
      <section className="flex flex-col gap-2">
        <h3 className="heading">Forge login</h3>
        <p className="small text-muted-foreground">
          Your GitHub or GitLab username. A label or comment you write on the forge counts as your decision only while
          it is linked here{login ? '' : ', and you have not linked one'}.
        </p>
        <SettingsForm action={saveOwnLogin}>
          <Field name="githubLogin" label="Login" example="sbuckpesch" defaultValue={login ?? ''} />
        </SettingsForm>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="heading">Theme</h3>
        <p className="small text-muted-foreground">Stored in this browser only.</p>
        <ThemePicker />
      </section>
    </>
  )
}
