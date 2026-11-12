import { AutoRefresh } from '../../components/AutoRefresh'
import { EmptyState } from '../../components/EmptyState'
import { PageTitle } from '../../components/PageTitle'
import { TeamView } from '../../components/team/TeamView'
import { currentWorkspace, payloadClient } from '../../lib/session'
import { isAdmin } from '../../lib/settings'
import { loadTeamCost } from '../../lib/cost'
import { loadModelOptions } from '../../lib/team'
import { loadGatewaySetup } from '../../lib/gateway-setup'
import { loadTeam } from '../../../../lib/sessions'
import { saveRole } from './actions'

export const dynamic = 'force-dynamic'

const DOCS = 'https://github.com/getbauherr/bauherr/blob/main/docs/session-mode.md#connect-as-a-role'

export default async function Team() {
  const { user, workspace } = await currentWorkspace()
  if (!workspace) return <EmptyState text="You have no Workspace yet." />
  const payload = await payloadClient()
  const admin = isAdmin(user)
  const [team, modelOptions, cost] = await Promise.all([loadTeam(payload, workspace.id), admin ? loadModelOptions(payload, workspace.id) : [], loadTeamCost(payload, workspace.id)])
  const gateway = await loadGatewaySetup(payload, workspace, admin)
  const mcpLine = `claude mcp add --transport http bauherr ${process.env.PUBLIC_URL ?? 'http://localhost:3000'}/mcp --header "Authorization: Bearer <your agent key>"`
  return (
    <>
      <PageTitle>Agent team</PageTitle>
      <AutoRefresh />
      <h1 className="title">Agent team</h1>
      <TeamView roles={team.roles} orphans={team.orphans} modelOptions={modelOptions} canEdit={admin} onSave={saveRole} docsHref={DOCS} mcpLine={mcpLine} gateway={gateway} cost={cost} />
    </>
  )
}
