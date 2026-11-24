import { describe, expect, it } from 'vitest'
import { AGENT_INSTRUCTIONS, IDLE_PAUSE_MINUTES } from '../../src/core/run/mcp/instructions'

describe('agent instructions on connect', () => {
  it('tell an idle session to keep calling for work', () => {
    expect(AGENT_INSTRUCTIONS).toContain('keep polling while the queue is empty')
  })

  it('tell the session to stop only when the owner says so', () => {
    expect(AGENT_INSTRUCTIONS).toContain('Stop only when the owner says so, never because there is no work')
  })

  it('name a pause of at least one minute between idle calls', () => {
    expect(IDLE_PAUSE_MINUTES).toBeGreaterThanOrEqual(1)
    expect(AGENT_INSTRUCTIONS).toContain(`On idle: wait ${IDLE_PAUSE_MINUTES} minute`)
  })
})
