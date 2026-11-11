import { SessionList } from './SessionList'
import { teamSummary } from './helpers'
import { TeamSelect } from './TeamSelect'
import type { ModelOption, RoleSettings, SaveResult, TeamRole, TeamSession } from './types'

type Props = {
  roles: TeamRole[]
  orphans: (TeamSession & { role: string })[]
  modelOptions: ModelOption[]
  canEdit: boolean
  onSave: (roleId: string, settings: RoleSettings) => SaveResult | Promise<SaveResult>
  docsHref: string
  mcpLine: string
}

export function TeamView({ roles, orphans, modelOptions, canEdit, onSave, docsHref, mcpLine }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <p className="small m-0 text-muted-foreground" role="status" data-testid="team-summary">{teamSummary(roles)}</p>
      <TeamSelect roles={roles} modelOptions={modelOptions} canEdit={canEdit} onSave={onSave} docsHref={docsHref} mcpLine={mcpLine} />
      <div className="flex flex-col gap-4">
        <h2 className="heading">Sessions</h2>
        <SessionList roles={roles} orphans={orphans} />
      </div>
    </div>
  )
}
