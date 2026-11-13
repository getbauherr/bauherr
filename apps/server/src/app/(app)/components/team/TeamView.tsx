import type { TeamCost } from '../../lib/cost'
import type { GatewaySetup } from '../../lib/harnesses'
import { SessionList } from './SessionList'
import { teamSummary } from './helpers'
import { TeamSelect } from './TeamSelect'
import type { ModelOption, RoleSettings, SaveResult, TeamRole, TeamSession } from './types'

type Props = {
  /** The role card chosen on load (`/team?role=`). */
  initialRole?: string
  roles: TeamRole[]
  orphans: (TeamSession & { role: string })[]
  modelOptions: ModelOption[]
  canEdit: boolean
  onSave: (roleId: string, settings: RoleSettings) => SaveResult | Promise<SaveResult>
  docsHref: string
  mcpLine: string
  gateway?: GatewaySetup
  cost?: TeamCost
}

export function TeamView({ initialRole, roles, orphans, modelOptions, canEdit, onSave, docsHref, mcpLine, gateway, cost }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <p className="small m-0 text-muted-foreground" role="status" data-testid="team-summary">{teamSummary(roles)}</p>
      <TeamSelect initialRole={initialRole} roles={roles} modelOptions={modelOptions} canEdit={canEdit} onSave={onSave} docsHref={docsHref} mcpLine={mcpLine} gateway={gateway} />
      <div className="flex flex-col gap-4">
        <h2 className="heading">Sessions</h2>
        <SessionList roles={roles} orphans={orphans} cost={cost} />
      </div>
    </div>
  )
}
