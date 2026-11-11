import { describe, expect, it } from 'vitest'
import { clock, groupOptions, teamSummary, tagline } from '../src/app/(app)/components/team/helpers'
import { modelOptions, roles } from '../src/app/(app)/components/team/fixture'

describe('team helpers', () => {
  it('takes the first sentence of a markdown profile', () => {
    expect(tagline('# Title\n\nBuilds the **change** and opens the MR.\n\nMore.')).toBe('Builds the change and opens the MR.')
    expect(tagline('No full stop here')).toBe('No full stop here')
  })
  it('summarises roles, connected and working sessions', () => {
    expect(teamSummary(roles)).toBe('6 roles · 3 sessions connected · 1 working')
    expect(teamSummary(roles.slice(0, 1))).toBe('1 role · 1 session connected · 0 working')
  })
  it('lists tiers before provider groups', () => {
    expect(groupOptions([...modelOptions].reverse()).map(([g]) => g)).toEqual(['Tier', 'OpenAI', 'Anthropic'])
  })
  it('formats UTC clock time', () => expect(clock('2026-01-01T09:14:59Z')).toBe('09:14 UTC'))
})
