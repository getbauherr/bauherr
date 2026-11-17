'use client'
import { Button } from '../ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../ui/sheet'
import { Table } from '../ui/table'
import { Chip } from './Chip'
import { RoleAvatar } from './RoleAvatar'
import { RoleBody, RoleSettingsForm, type SettingsProps } from './RoleSettings'
import { agentsLabel, modelName } from './helpers'
import type { TeamRole } from './types'

/** Compact Roles table. With `settings` (Model, Agents and Skills hidden below 768 px; the drawer shows them), each row opens a drawer with the model and agents form (read-only for non-Admins); without it (the setup wizard) the table is read-only. */
export function RolesTable({ roles, settings }: { roles: TeamRole[]; settings?: SettingsProps }) {
  const phoneHidden = settings ? 'max-md:hidden' : undefined // the drawer shows these on a phone; the wizard has no drawer, so it keeps them
  return (
    <Table data-testid="roles-table" aria-label="Roles" className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
      <thead>
        <tr className="label">
          <th>Role</th>
          <th className={phoneHidden}>Model</th>
          <th className={phoneHidden}>Agents</th>
          <th className={phoneHidden}>Skills</th>
          <th>Waiting</th>
          {settings && <th><span className="sr-only">Actions</span></th>}
        </tr>
      </thead>
      <tbody>
        {roles.map((role) => (
          <tr key={role.id} data-role={role.id}>
            <td><span className="flex items-center gap-2"><RoleAvatar avatar={role.avatar} size="sm" animate={false} /><span className="heading">{role.title}</span></span></td>
            <td className={phoneHidden}>{modelName(role) ?? '–'}</td>
            <td className={phoneHidden}>{agentsLabel(role.agents)}</td>
            <td className={phoneHidden}><span className="flex flex-wrap gap-1">{role.skills.map((k) => <Chip key={k} muted>{k}</Chip>)}</span></td>
            <td className="mono">{role.waiting}</td>
            {settings && (
              <td className="text-right">
                <Sheet>
                  <SheetTrigger asChild><Button variant="outline" size="sm" aria-label="Role settings"><span className="max-sm:hidden">Role </span>settings</Button></SheetTrigger>
                  <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[480px]" aria-describedby={undefined}>
                    <SheetDescription className="sr-only">Model and agents of the role</SheetDescription>
                    <div className="flex flex-col gap-6 p-6">
                      <RoleBody role={role} heading={SheetTitle} />
                      <RoleSettingsForm role={role} {...settings} />
                    </div>
                  </SheetContent>
                </Sheet>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}
