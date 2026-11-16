'use client'
import { RoleAvatar } from './RoleAvatar'
import { RoleBody, RoleSettingsForm, type SettingsProps } from './TeamSelect'
import { agentsLabel, modelName } from './helpers'
import type { TeamRole } from './types'

/** The Roles part of /team: one disclosure per role with its profile and the model and agents form (replaced by the Roles table and drawer in the next step). */
export function RolesPart({ roles, ...settings }: SettingsProps & { roles: TeamRole[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {roles.map((role) => (
        <li key={role.id}>
          <details className="group rounded-md border border-border bg-card" data-testid="role-details" data-role={role.id}>
            <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <RoleAvatar avatar={role.avatar} size="sm" animate={false} />
              <span className="heading">{role.title}</span>
              <span className="small text-muted-foreground">{[modelName(role), agentsLabel(role.agents)].filter(Boolean).join(' · ')}</span>
            </summary>
            <div className="flex flex-col gap-6 border-t border-border p-6">
              <RoleBody role={role} heading="h3" />
              <RoleSettingsForm key={role.id} role={role} {...settings} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  )
}
