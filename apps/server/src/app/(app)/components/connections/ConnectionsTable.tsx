import { verifyConnection } from '../../(shell)/settings/actions'
import { connectionPresets as presets, type loadConnections } from '../../lib/settings'
import { EditDrawer } from '../EditDrawer'
import { ConnectionForm } from '../SettingsConnectionForm'
import { SettingsForm } from '../SettingsForm'
import { Badge } from '../ui/badge'
import { Table } from '../ui/table'
import { Input } from '../ui/input'

type Connection = Awaited<ReturnType<typeof loadConnections>>[number]

const chip = { ok: ['ok', 'Verified'], failed: ['destructive', 'Failed'], none: ['neutral', 'Not verified'] } as const

export function ConnectionsTable({ connections }: { connections: Connection[] }) {
  return (
    <Table>
      <thead>
        <tr className="label">
          <th>Name</th>
          <th>Kind</th>
          <th>Preset</th>
          <th>Status</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {connections.map((c) => (
          <tr key={c.id}>
            <td>{c.name}</td>
            <td>{c.kind}</td>
            <td>{c.provider || <span className="text-muted-foreground">n/a</span>}</td>
            <td>
              <Badge variant={chip[c.status === 'none' && c.inUse ? 'ok' : c.status][0]}>
                {c.status === 'none' && c.inUse ? 'In use' : chip[c.status][1]}
              </Badge>{' '}
              {c.detail && (
                <span className="small text-muted-foreground">
                  {c.status === 'ok' ? c.detail.slice(0, 16).replace('T', ' ') : c.detail}
                </span>
              )}
            </td>
            <td>
              <div className="flex flex-wrap items-center justify-start gap-3">
                <EditDrawer>
                  <ConnectionForm
                    presets={presets}
                    value={{ id: c.id, name: c.name, kind: c.kind, provider: c.provider, config: c.config }}
                  />
                </EditDrawer>
                <SettingsForm action={verifyConnection} submit="Verify again" inline>
                  <Input type="hidden" name="id" value={c.id} />
                </SettingsForm>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
