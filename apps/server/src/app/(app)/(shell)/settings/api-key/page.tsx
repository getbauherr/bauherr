import { hasApiKey } from '../../../../../lib/api-key'
import { SettingsForm } from '../../../components/SettingsForm'
import { payloadClient, requireBauherr } from '../../../lib/session'
import { revokeOwnKey, rotateOwnKey } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ApiKey() {
  const user = await requireBauherr()
  const has = await hasApiKey(await payloadClient(), user.id)
  return (
    <>
      <h2 className="heading">API key</h2>
      <p className="small muted">Connects your own Claude Code session to the factory (<a className="link" href="https://github.com/getbauherr/bauherr/blob/main/docs/session-mode.md">session mode</a>). It acts as you, inside your Workspaces only.</p>
      {has ? (
        <>
          <p className="small">A key is active. It is shown once, when created; rotating replaces it and invalidates the old one.</p>
          <SettingsForm action={rotateOwnKey} submit="Rotate key" confirm="Confirm rotate" primary />
          <h3 className="heading">Revoke</h3>
          <p className="small muted">Stops the key working at once. No new key is created.</p>
          <SettingsForm action={revokeOwnKey} submit="Revoke key" confirm="Confirm revoke" />
        </>
      ) : (
        <>
          <p className="small">No key yet. It is shown once, as the command that adds the factory to Claude Code.</p>
          <SettingsForm action={rotateOwnKey} submit="Create key" primary />
        </>
      )}
    </>
  )
}
