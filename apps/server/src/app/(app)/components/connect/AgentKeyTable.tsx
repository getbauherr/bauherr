import { SettingsForm } from '../SettingsForm'
import { Table } from '../ui/table'
import { revokeOwnAgentKey } from '../../(shell)/settings/actions'

type Key = { id: number; label: string; prefix: string; lastUsedAt?: string; revokedAt?: string }

const lastUsed = (key: Key): string =>
  key.revokedAt ? 'revoked' : (key.lastUsedAt?.slice(0, 16).replace('T', ' ') ?? 'never')

export function AgentKeyTable({ keys }: { keys: Key[] }) {
  return (
    <Table>
      <thead>
        <tr className="label">
          <th>Label</th>
          <th>Key</th>
          <th>Last used</th>
          <th>
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k.id}>
            <td>{k.label}</td>
            <td className="mono">{k.prefix}…</td>
            <td>{lastUsed(k)}</td>
            <td>
              {!k.revokedAt && (
                <SettingsForm action={revokeOwnAgentKey} submit="Revoke" confirm="Confirm revoke" inline>
                  <input type="hidden" name="id" value={k.id} />
                </SettingsForm>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
