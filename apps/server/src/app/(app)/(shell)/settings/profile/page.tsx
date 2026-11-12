import { Table } from '../../../components/ui/table'
import { ThemePicker } from '../../../components/ThemeToggle'
import { assignmentWords, isProductOwner } from '../../../../../lib/people'
import { requirePerson, workspacesOf, payloadClient, type Bauherr } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const ROLE = { admin: 'Admin', bauherr: 'Bauherr', 'product-owner': 'Product owner' } as const

/** What the Product owner is assigned to, in words; reads the assignment's Workspace and Product names. */
async function assignmentOf(user: { assignments?: unknown[] }): Promise<string> {
  const payload = await payloadClient()
  const rows = (user.assignments ?? []) as { workspace: { name: string } | number; scope: 'workspace' | 'products'; products?: ({ name: string } | number)[] }[]
  const name = async (collection: 'workspaces' | 'products', v: { name: string } | number) => (typeof v === 'object' ? v.name : ((await payload.findByID({ collection, id: v, depth: 0, overrideAccess: true }).catch(() => null)) as { name?: string } | null)?.name ?? '')
  return assignmentWords(await Promise.all(rows.map(async (r) => ({ workspace: await name('workspaces', r.workspace), scope: r.scope, products: await Promise.all((r.products ?? []).map((p) => name('products', p))) }))))
}

/** Account: the signed-in person's own record (read-only; an Admin changes role, Workspaces and GitHub login under People) and the theme of this browser. Open to a Product owner too. */
export default async function Profile() {
  const user = await requirePerson()
  const owner = isProductOwner(user)
  const workspaces = owner ? [] : await workspacesOf(user as Bauherr)
  const login = (user as { githubLogin?: string | null }).githubLogin
  return (
    <>
      <h2 className="heading">Profile</h2>
      {owner && <p>Your account is set up. The pages for your Products follow.</p>}
      <Table>
        <tbody>
          <tr><th>Email</th><td>{user.email}</td></tr>
          <tr><th>Role</th><td>{ROLE[user.role]}</td></tr>
          <tr><th>GitHub login</th><td>{login ? `@${login}` : <span className="text-muted-foreground">Not set. An Admin sets it under People.</span>}</td></tr>
          {owner ? <tr><th>Assigned to</th><td>{await assignmentOf(user)}</td></tr> : <tr><th>Workspaces</th><td>{workspaces.map((w) => w.name).join(', ') || <span className="text-muted-foreground">None</span>}</td></tr>}
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
