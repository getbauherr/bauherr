import { plural } from './helpers'
import { ConnectRoleButton } from './ConnectPanel'
import { RoleAvatar } from './RoleAvatar'
import type { TeamRole } from './types'

/** A role with Tickets waiting and no connected agent; Connect selects it in the Connect panel. */
export function NeedsAgentRow({ role }: { role: TeamRole }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 last:border-b-0" data-testid="needs-agent-row" data-role={role.id}>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <RoleAvatar avatar={role.avatar} size="sm" animate={false} />
        <span className="truncate font-medium">{role.title}<span className="small font-normal text-muted-foreground"> · no agent</span></span>
      </span>
      <span className="small text-warn">{plural(role.waiting, 'ticket')} waiting</span>
      <ConnectRoleButton role={role.id} />
    </li>
  )
}
