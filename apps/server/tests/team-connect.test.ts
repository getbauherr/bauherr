import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/app/(app)/components/gateway/HarnessSetup', () => ({ HarnessSetup: () => null }))

import { ConnectPanel } from '../src/app/(app)/components/team/ConnectPanel'
import { defaultRole, listRows, connectPrompt } from '../src/app/(app)/components/team/helpers'
import { roles } from '../src/app/(app)/components/team/fixture'
import type { TeamRole, TeamSession } from '../src/app/(app)/components/team/types'

const at = (min: number) => new Date(Date.UTC(2026, 10, 16, 12, 0) - min * 6e4).toISOString()
const clean: TeamRole[] = roles.map((r) => ({ ...r, waiting: 0, sessions: [], autonomous: [] }))
const withSession = (id: string, s: Partial<TeamSession>, extra: Partial<TeamRole> = {}): TeamRole[] =>
  clean.map((r) => (r.id === id ? { ...r, ...extra, sessions: [{ ...roles[1]!.sessions[1]!, ...s }] } : r))

describe('default role', () => {
  it('prefers a role with waiting work and no agent, most waiting first, ties in workflow order', () => {
    const r = clean.map((x) => (x.id === 'reviewer' ? { ...x, waiting: 3 } : x.id === 'ux' ? { ...x, waiting: 3 } : x.id === 'engineer' ? { ...x, waiting: 1 } : x))
    expect(defaultRole(r, 'test')).toEqual({ id: 'reviewer', hint: 'Default: 3 tickets waiting, no agent' })
    expect(defaultRole(clean.map((x) => (x.id === 'ux' ? { ...x, waiting: 1 } : x)))?.hint).toBe('Default: 1 ticket waiting, no agent')
  })
  it('ignores waiting work of a role that has a connected agent', () => {
    expect(defaultRole(withSession('engineer', { status: 'idle', health: 'idle' }, { waiting: 2 }), 'ux')).toEqual({ id: 'ux', hint: 'Default: last used' })
  })
  it('falls back to the last used role, then the most recently connected, then the first', () => {
    expect(defaultRole(clean, 'security')).toEqual({ id: 'security', hint: 'Default: last used' })
    expect(defaultRole(withSession('ux', { connectedAt: at(5), status: 'offline', health: 'disconnected' }), 'gone')).toEqual({ id: 'ux', hint: 'Default: most recently connected' })
    expect(defaultRole(clean, 'gone')).toEqual({ id: 'orchestrator', hint: 'Default: first role' })
    expect(defaultRole([])).toBeUndefined()
  })
})

describe('sessions list rows', () => {
  const s = (publicId: string, extra: Partial<TeamSession>): TeamSession => ({ ...roles[1]!.sessions[1]!, publicId, ...extra })
  const team: TeamRole[] = clean.map((r) =>
    r.id === 'engineer'
      ? {
          ...r,
          sessions: [
            s('idle-old', { status: 'idle', health: 'idle', lastSeenAt: at(30) }),
            s('idle-new', { status: 'idle', health: 'idle', lastSeenAt: at(1) }),
            s('work-new', { status: 'working', health: 'working', run: 2, runStartedAt: at(3) }),
            s('work-old', { status: 'working', health: 'working', run: 1, runStartedAt: at(40) }),
            s('gone-old', { status: 'offline', health: 'disconnected', disconnectedAt: at(300) }),
            s('gone-new', { status: 'offline', health: 'disconnected', disconnectedAt: at(10) }),
          ],
          autonomous: [{ run: 7, executor: 'ci', ticket: { number: 1, title: 't', stage: 'build' }, startedAt: at(20), model: null }],
        }
      : r.id === 'ux' ? { ...r, waiting: 1 } : r.id === 'reviewer' ? { ...r, waiting: 4 } : r,
  )
  const orphan = { ...s('orphan', { status: 'idle', health: 'idle' }), role: 'removed' }

  it('puts needs-an-agent rows first, then working (longest first, Runner and CI with them), idle (latest first) and sessions without a role', () => {
    expect(listRows(team, [orphan]).rows.map((r) => r.key)).toEqual(['needs-reviewer', 'needs-ux', 'work-old', 'run-7', 'work-new', 'idle-new', 'idle-old', 'orphan'])
  })
  it('hides disconnected sessions behind the toggle, latest first', () => {
    expect(listRows(team, []).disconnected.map((r) => r.key)).toEqual(['gone-new', 'gone-old'])
  })
})

describe('Connect panel', () => {
  const props = { workspaceId: 1, roles, docsHref: '/docs', mcpLine: 'claude mcp add x' }
  const html = (p: Record<string, unknown>) => renderToStaticMarkup(createElement(ConnectPanel, { ...props, ...p } as never))
  it('with no agent key disables Copy prompt, says why and opens First-time setup', () => {
    const out = html({ presence: { key: false, anySession: true } })
    expect(out).toMatch(/<button[^>]* disabled=""[^>]*>Copy prompt<\/button>/)
    expect(out).toContain('Create an agent key first.')
    expect(out).toMatch(/<details[^>]* open/)
  })
  it('with a key and a session ever keeps Copy prompt enabled and the disclosure closed', () => {
    const out = html({ presence: { key: true, anySession: true } })
    expect(out).not.toMatch(/<button[^>]* disabled=""[^>]*>Copy prompt/)
    expect(out).not.toContain('Create an agent key first.')
    expect(out).not.toMatch(/<details[^>]* open/)
    expect(out).toContain(connectPrompt({ id: 'orchestrator' }).replace(/&/g, '&amp;'))
  })
  it('opens First-time setup when no session ever connected, and /team?role= wins over the default', () => {
    expect(html({ presence: { key: true, anySession: false } })).toMatch(/<details[^>]* open/)
    expect(html({ presence: { key: true, anySession: true }, initialRole: 'ux' })).toContain('Connect to the factory as ux ')
  })
})
