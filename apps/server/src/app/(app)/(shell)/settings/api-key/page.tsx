import { hasApiKey, listAgentKeys } from '../../../../../lib/api-key'
import { Field, SettingsForm } from '../../../components/SettingsForm'
import { payloadClient, requireBauherr } from '../../../lib/session'
import { mintOwnAgentKey, revokeOwnAgentKey, revokeOwnKey, rotateOwnKey } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ApiKey() {
  const user = await requireBauherr()
  const payload = await payloadClient()
  const [has, keys] = await Promise.all([hasApiKey(payload, user.id), listAgentKeys(payload, user)])
  return (
    <>
      <h2 className="heading">Agent keys</h2>
      <p className="small muted">Connect a Claude Code session to the factory (<a className="link" href="https://github.com/getbauherr/bauherr/blob/main/docs/session-mode.md">session mode</a>). It acts as you, inside your Workspaces only, but cannot approve gates: approve, accept, request changes, review cap. Those stay with you in the UI.</p>
      <SettingsForm action={mintOwnAgentKey} submit="Create agent key" primary reset>
        <Field name="label" label="Label" hint="Where it runs, e.g. laptop" />
      </SettingsForm>
      {keys.length > 0 && (
        <table className="table">
          <thead><tr><th>Label</th><th>Key</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td className="mono">{k.prefix}…</td>
                <td>{k.revokedAt ? 'revoked' : (k.lastUsedAt?.slice(0, 16).replace('T', ' ') ?? 'never')}</td>
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
        </table>
      )}
      <h2 className="heading">Personal key (human)</h2>
      <p className="small err">Never give this key to an agent; it can approve gates.</p>
      {has ? (
        <>
          <p className="small">A personal key is active. It is shown once; rotating replaces it.</p>
          <SettingsForm action={rotateOwnKey} submit="Rotate personal key" confirm="Confirm rotate" />
          <SettingsForm action={revokeOwnKey} submit="Revoke personal key" confirm="Confirm revoke personal" />
        </>
      ) : (
        <SettingsForm action={rotateOwnKey} submit="Create personal key" />
      )}
    </>
  )
}
