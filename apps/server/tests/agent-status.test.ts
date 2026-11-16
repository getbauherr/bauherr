import { describe, expect, it } from 'vitest'
import { agentStatus } from '../src/app/(app)/components/team/agent-status'

const now = Date.parse('2026-11-16T12:00:00Z')
const at = (min: number) => new Date(now - min * 6e4).toISOString()
const view = (s: Record<string, unknown>, ci?: { passed: number; total: number }) => ({ session: { publicId: 'ses_a', role: 'engineer', lastSeenAt: at(0), disconnectedAt: null, endReason: null, ...s } as never, ci })

describe('agentStatus', () => {
  it('working names the activity and Ticket; pending checks say Waiting for CI n/m', () => {
    expect(agentStatus(view({ health: 'working', activity: 'building', ticket: { number: 7 } }), now)).toBe('Building #7')
    expect(agentStatus(view({ health: 'working', activity: 'building', ticket: { number: 7 } }, { passed: 3, total: 4 }), now)).toBe('Waiting for CI 3/4')
  })
  it('idle, stuck and not responding', () => {
    expect(agentStatus(view({ health: 'idle' }), now)).toBe('Idle, waiting for work')
    expect(agentStatus(view({ health: 'stuck', lastSeenAt: at(15) }), now)).toBe('Stuck: no signal for 15 min while holding a Run')
    expect(agentStatus(view({ health: 'not-responding', lastSeenAt: at(12) }), now)).toBe('Not responding: no signal for 12 min')
  })
  it('disconnected gives its reason', () => {
    expect(agentStatus(view({ health: 'disconnected', endReason: 'disconnect', disconnectedAt: at(1) }), now)).toBe('Disconnected: The agent ended the session.')
    expect(agentStatus(view({ health: 'disconnected', endReason: 'timeout', lastSeenAt: at(30), disconnectedAt: at(20) }), now)).toBe('Disconnected: No signal for 10 min.')
    expect(agentStatus(view({ health: 'disconnected', endReason: 'replaced', disconnectedAt: at(1) }), now)).toBe('Disconnected: A newer session took its place.')
  })
})
