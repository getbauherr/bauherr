import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoleSettingsForm } from '../src/app/(app)/components/team/RoleSettings'
import { RolesTable } from '../src/app/(app)/components/team/RolesTable'
import type { TeamRole } from '../src/app/(app)/components/team/types'

const role = (id: string, extra: Partial<TeamRole> = {}) => ({ id, title: id[0]!.toUpperCase() + id.slice(1), avatar: 'a', skills: ['tdd'], profile: '', exceptions: false, stages: [], waiting: 0, sessions: [], autonomous: [], ...extra }) as TeamRole

describe('Roles table', () => {
  const roles = [role('engineer', { tier: 'cheap', agents: 2, waiting: 3 }), role('reviewer')]
  const settings = { modelOptions: [], canEdit: false, onSave: () => {} }
  const html = renderToStaticMarkup(createElement(RolesTable, { roles, settings }))
  it('lists the columns, one row per role, "No limit" and a Role settings button per row', () => {
    for (const h of ['Role', 'Model', 'Agents', 'Skills', 'Waiting']) expect(html).toContain(`>${h}</th>`)
    expect(html).toContain('Cheap tier')
    expect(html).toContain('2 agents')
    expect(html).toContain('No limit')
    expect(html.match(/Role settings/g)).toHaveLength(2)
  })
  it('has no Role settings button without settings (setup wizard)', () => {
    expect(renderToStaticMarkup(createElement(RolesTable, { roles }))).not.toContain('Role settings')
  })
})

describe('Role settings form', () => {
  const form = (canEdit: boolean) => renderToStaticMarkup(createElement(RoleSettingsForm, { role: role('engineer', { agents: 2 }), modelOptions: [], canEdit, onSave: () => {} }))
  it('is disabled with the owner sentence for a non-Admin', () => {
    const html = form(false)
    expect(html).toContain('Only the owner can change a role.')
    expect(html.match(/disabled=""/g)!.length).toBeGreaterThanOrEqual(5)
  })
  it('has no sentence for an Admin', () => {
    expect(form(true)).not.toContain('Only the owner')
  })
})
