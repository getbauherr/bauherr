import { describe, expect, it } from 'vitest'
import { agentsLabel, groupOptions, profileMarkdown, modelName, modelValue, teamSummary, tagline } from '../src/app/(app)/components/team/helpers'
import { durationHm } from '../src/app/(app)/lib/format'
import { withRoleSettings } from '../src/app/(app)/lib/team'
import { stageAgents } from '../src/app/(app)/lib/workflow-view'
import { modelOptions, roles } from '../src/app/(app)/components/team/fixture'

describe('team helpers', () => {
  it('takes the first sentence of a markdown profile', () => {
    expect(tagline('# Title\n\nBuilds the **change** and opens the MR.\n\nMore.')).toBe('Builds the change and opens the MR.')
    expect(tagline('---\nname: engineer\ntitle: Engineer\n---\nMission: turn a Ticket into a plan. More.')).toBe('Turn a Ticket into a plan.')
    expect(tagline('No full stop here')).toBe('No full stop here')
  })
  it('turns label lines of a profile into bold paragraphs and leaves free text', () => {
    expect(profileMarkdown('---\nname: x\n---\nMission: do it.\nPicks up: plan runs.')).toBe('\n**Mission.** do it.\n\n**Picks up.** plan runs.')
    expect(profileMarkdown('Just some free text. No label.')).toBe('Just some free text. No label.')
  })
  it('summarises roles, connected and working sessions', () => {
    expect(teamSummary(roles)).toBe('6 roles · 3 sessions connected · 1 working')
    expect(teamSummary(roles.slice(0, 1))).toBe('1 role · 1 session connected · 0 working')
  })
  it('lists tiers before provider groups', () => {
    expect(groupOptions([...modelOptions].reverse()).map(([g]) => g)).toEqual(['Tier', 'Anthropic'])
  })
  it('labels agents and models', () => {
    expect([agentsLabel(1), agentsLabel(3), agentsLabel()]).toEqual(['1 agent', '3 agents', 'No limit'])
    expect([modelValue({ tier: 'cheap' }), modelValue({ provider: 'a', model: 'm' }), modelValue({})]).toEqual(['tier:cheap', 'a/m', undefined])
    expect(modelName({ tier: 'strong' })).toBe('Strong tier')
  })
  it('formats hours and minutes', () => expect([durationHm(30), durationHm(2400), durationHm(4320), durationHm(7200)]).toEqual(['30 s', '40 min', '1 h 12 min', '2 h']))
})

describe('team page logic', () => {
  const yaml = 'team:\n  roles:\n    engineer: {title: Engineer, tier: cheap, agents: 2}\n    reviewer: {title: Reviewer, provider: anthropic, model: m}\n'
  it('rewrites the model and the agent cap of one role', () => {
    expect(withRoleSettings(yaml, 'engineer', { model: 'anthropic/claude-x/y', agents: undefined })).toContain('engineer: { title: Engineer, provider: anthropic, model: claude-x/y }')
    expect(withRoleSettings(yaml, 'reviewer', { model: 'tier:strong', agents: 3 })).toContain('reviewer: { title: Reviewer, tier: strong, agents: 3 }')
    expect(() => withRoleSettings(yaml, 'nobody', {})).toThrow(/not in the factory file/)
  })
  it('says who is stationed at a stage, and flags a session stage nobody serves', () => {
    const wf = { version: 1, aliases: {}, roles: [], stages: [{ name: 'build', title: 'Build', kind: 'build', role: 'engineer', outcomes: {} }, { name: 'review', title: 'Review', kind: 'review', role: 'reviewer', outcomes: {} }] } as never
    const a = stageAgents(wf, roles, (s) => (s === 'review' ? 'session' : 'autonomous'))
    expect(a.get('build')?.text).toBe('1 working · 1 idle · Runner working')
    expect(a.get('review')).toMatchObject({ text: 'No agent connected', missing: true })
  })
})
