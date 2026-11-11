import { Table } from '../../../components/ui/table'
import { ThemePicker } from '../../../components/ThemeToggle'
import { requireBauherr, workspacesOf } from '../../../lib/session'

export const dynamic = 'force-dynamic'

/** Account: the signed-in person's own record (read-only; an Admin changes role, Workspaces and GitHub login under People) and the theme of this browser. */
export default async function Profile() {
  const user = await requireBauherr()
  const workspaces = await workspacesOf(user)
  const login = (user as { githubLogin?: string | null }).githubLogin
  return (
    <>
      <h2 className="heading">Profile</h2>
      <Table>
        <tbody>
          <tr><th>Email</th><td>{user.email}</td></tr>
          <tr><th>Role</th><td>{user.role === 'admin' ? 'Admin' : 'Member'}</td></tr>
          <tr><th>GitHub login</th><td>{login ? `@${login}` : <span className="text-muted-foreground">Not set. An Admin sets it under People.</span>}</td></tr>
          <tr><th>Workspaces</th><td>{workspaces.map((w) => w.name).join(', ') || <span className="text-muted-foreground">None</span>}</td></tr>
        </tbody>
      </Table>
      <section className="flex flex-col gap-2">
        <h3 className="heading">Theme</h3>
        <p className="small text-muted-foreground">Stored in this browser only.</p>
        <ThemePicker />
      </section>
    </>
  )
}
