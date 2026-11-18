import type { TeamCost } from '../../lib/cost'
import type { GatewaySetup } from '../../lib/harnesses'
import { ConnectPanel } from './ConnectPanel'
import { NeedsAgentRow } from './NeedsAgentRow'
import { RolesTable } from './RolesTable'
import { SessionRow } from './SessionRow'
import { SessionsSection } from './SessionsSection'
import { listRows, teamSummary, type ListRow } from './helpers'
import type { ModelOption, RoleSettings, SaveResult, TeamRole, TeamSession } from './types'

type Props = {
  workspaceId: number | string
  initialRole?: string
  roles: TeamRole[]
  orphans: (TeamSession & { role: string })[]
  presence: { key: boolean; anySession: boolean }
  modelOptions: ModelOption[]
  canEdit: boolean
  onSave: (roleId: string, settings: RoleSettings) => SaveResult | Promise<SaveResult>
  docsHref: string
  mcpLine: string
  gateway?: GatewaySetup
  cost?: TeamCost
}

export function TeamView({ workspaceId, initialRole, roles, orphans, presence, modelOptions, canEdit, onSave, docsHref, mcpLine, gateway, cost }: Props) {
  const { rows, disconnected } = listRows(roles, orphans)
  const row = (r: ListRow) => (r.kind === 'needs' ? <NeedsAgentRow key={r.key} role={r.role} /> : <SessionRow key={r.key} row={r} costs={cost?.sessions} />)
  return (
    <div className="flex flex-col gap-8">
      <p className="small m-0 text-muted-foreground" role="status" data-testid="team-summary">{teamSummary(roles)}</p>
      <ConnectPanel workspaceId={workspaceId} roles={roles} initialRole={initialRole} presence={presence} docsHref={docsHref} mcpLine={mcpLine} gateway={gateway} />
      <SessionsSection workspaceId={workspaceId} rows={rows.map(row)} disconnected={disconnected.map(row)} count={disconnected.length} />
      <section aria-labelledby="roles-heading" className="flex flex-col gap-4">
        <h2 id="roles-heading" className="heading">Roles</h2>
        <RolesTable roles={roles} settings={{ modelOptions, canEdit, onSave }} />
      </section>
    </div>
  )
}
