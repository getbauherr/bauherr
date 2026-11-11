import { notFound } from 'next/navigation'
import { EditDrawer } from '../../../components/EditDrawer'
import { EmptyState } from '../../../components/EmptyState'
import { ConnectionForm } from '../../../components/SettingsConnectionForm'
import { SettingsForm } from '../../../components/SettingsForm'
import { Badge } from '../../../components/ui/badge'
import { Card } from '../../../components/ui/card'
import { Table } from '../../../components/ui/table'
import { connectionPresets as presets, isAdmin, loadConnections } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { verifyConnection } from '../actions'

export const dynamic = 'force-dynamic'

const chip = { ok: ['ok', 'Verified'], failed: ['destructive', 'Failed'], none: ['neutral', 'Not verified'] } as const

export default async function ConnectionSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const connections = await loadConnections(workspace.id)
  return (
    <>
      <h2 className="heading">Connections</h2>
      {!connections.length && <EmptyState text={`${workspace.name} has no Connections yet.`} />}
      {connections.length > 0 && (
        <Table>
            <thead><tr className="label"><th>Name</th><th>Kind</th><th>Preset</th><th>Status</th><th /></tr></thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.kind}</td>
                  <td>{c.provider || <span className="text-muted-foreground">n/a</span>}</td>
                  <td>
                    <Badge variant={chip[c.status === 'none' && c.inUse ? 'ok' : c.status][0]}>{c.status === 'none' && c.inUse ? 'In use' : chip[c.status][1]}</Badge>{' '}
                    {c.detail && <span className="small text-muted-foreground">{c.status === 'ok' ? c.detail.slice(0, 16).replace('T', ' ') : c.detail}</span>}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center justify-start gap-3">
                      <EditDrawer><ConnectionForm presets={presets} value={{ id: c.id, name: c.name, kind: c.kind, provider: c.provider, config: c.config }} /></EditDrawer>
                      <SettingsForm action={verifyConnection} submit="Verify again" inline><input type="hidden" name="id" value={c.id} /></SettingsForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
        </Table>
      )}
      <Card asChild className="gap-4"><section>
        <h2 className="heading">Add Connection</h2>
        <ConnectionForm presets={presets} submit="Add Connection" reset primary />
      </section></Card>
    </>
  )
}
