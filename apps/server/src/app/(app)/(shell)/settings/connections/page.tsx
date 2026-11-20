import { notFound } from 'next/navigation'
import { ConnectionsTable } from '../../../components/connections/ConnectionsTable'
import { EmptyState } from '../../../components/EmptyState'
import { ConnectionWebhook } from '../../../components/ConnectionWebhook'
import { ConnectionForm } from '../../../components/SettingsConnectionForm'
import { Card } from '../../../components/ui/card'
import { connectionPresets as presets, isAdmin, loadConnections } from '../../../lib/settings'
import { currentWorkspace } from '../../../lib/session'
import { webhookStates } from '../../../lib/webhook'

export const dynamic = 'force-dynamic'

export default async function ConnectionSettings() {
  const { user, workspace } = await currentWorkspace()
  if (!isAdmin(user)) notFound()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const connections = await loadConnections(workspace.id)
  const hooks = await webhookStates(workspace.id)
  const unused = { hasSecret: false, deliveredAt: null }
  return (
    <>
      <h2 className="heading">Connections</h2>
      {!connections.length && <EmptyState text={`${workspace.name} has no Connections yet.`} />}
      {connections.length > 0 && <ConnectionsTable connections={connections} />}
      {connections
        .filter((c) => c.kind !== 'llm-provider')
        .map((c) => (
          <ConnectionWebhook key={c.id} connection={c} webhook={hooks.get(c.id) ?? unused} />
        ))}
      <Card asChild className="gap-4">
        <section>
          <h2 className="heading">Add Connection</h2>
          <ConnectionForm presets={presets} submit="Add Connection" reset primary />
        </section>
      </Card>
    </>
  )
}
