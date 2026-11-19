import { notFound } from 'next/navigation'
import { EmptyState } from '../../../components/EmptyState'
import { Field } from '../../../components/SettingsForm'
import { Button } from '../../../components/ui/button'
import { Table } from '../../../components/ui/table'
import { isAdmin, loadAudit } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const sp = await searchParams
  const rows = await loadAudit(workspace.id, sp)
  return (
    <>
      <h2 className="heading">Audit</h2>
      <form className="flex flex-col gap-4" method="get">
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
          <Field name="actor" label="Actor" defaultValue={sp.actor ?? ''} />
        </div>
        <div><Button variant="outline">Filter</Button></div>
      </form>
      {!rows.length ? (
        <EmptyState text="No entries match." />
      ) : (
        <Table>
          <thead><tr className="label"><th>When</th><th>Kind</th><th>Actor</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.at ? new Date(r.at).toISOString().slice(0, 19).replace('T', ' ') : '—'}</td>
                <td>{r.kind}</td>
                <td>{r.actor === 'factory' ? <span className="text-muted-foreground">Factory</span> : r.actor}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
