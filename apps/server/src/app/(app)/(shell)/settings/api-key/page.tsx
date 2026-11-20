import { hasApiKey, listAgentKeys } from '../../../../../lib/api-key'
import { agentSessions } from '../../../../../core/views/sessions'
import { publicUrl } from '../../../../../lib/oidc'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { AgentKeyForm } from '../../../components/connect/AgentKeyForm'
import { AgentKeyTable } from '../../../components/connect/AgentKeyTable'
import { SessionsTable } from '../../../components/connect/SessionsTable'
import { SettingsForm } from '../../../components/SettingsForm'
import { currentWorkspace, payloadClient } from '../../../lib/session'
import { mintOwnAgentKey, revokeOwnKey, rotateOwnKey } from '../actions'

export const dynamic = 'force-dynamic'

export default async function ApiKey() {
  const { user, workspace } = await currentWorkspace()
  const payload = await payloadClient()
  const [has, keys, sessions] = await Promise.all([
    hasApiKey(payload, user.id),
    workspace ? listAgentKeys(payload, user, workspace.id) : [],
    workspace ? agentSessions(payload, { workspace: workspace.id, owner: Number(user.id), now: new Date() }) : [],
  ])
  return (
    <>
      <h2 className="heading">API keys</h2>
      <p className="small text-muted-foreground">
        Connect a Claude Code session to the factory. It acts as you, inside your Workspaces only, but cannot approve
        gates: approve, accept, request changes, review cap. Those stay with you in the UI.
      </p>
      <AgentKeyForm action={mintOwnAgentKey} url={publicUrl()} />
      {keys.length > 0 && <AgentKeyTable keys={keys} />}
      <SessionsTable sessions={sessions} />
      <AutoRefresh />
      <h2 className="heading">Personal key (human)</h2>
      <p className="small text-destructive">Never give this key to an agent; it can approve gates.</p>
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
