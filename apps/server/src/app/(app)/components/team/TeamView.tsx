import { SessionList } from './SessionList'
import { teamSummary } from './helpers'
import { TeamSelect } from './TeamSelect'
import type { ConnectPrompt, ModelOption, RoleSettings, TeamRole } from './types'

type Props = {
  roles: TeamRole[]
  modelOptions: ModelOption[]
  canEdit: boolean
  onSave: (roleId: string, settings: RoleSettings) => void | Promise<void>
  docsHref: string
  connectPrompt?: ConnectPrompt
}

export function TeamView({ roles, modelOptions, canEdit, onSave, docsHref, connectPrompt }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <p className="small text-muted-foreground" role="status">{teamSummary(roles)}</p>
      <TeamSelect roles={roles} modelOptions={modelOptions} canEdit={canEdit} onSave={onSave} docsHref={docsHref} connectPrompt={connectPrompt} />
      <div className="flex flex-col gap-4">
        <h2 className="heading">Sessions</h2>
        <SessionList roles={roles} connectPrompt={connectPrompt} />
      </div>
    </div>
  )
}
