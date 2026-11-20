import { describe, expect, it } from 'vitest'
import { parseEvent } from '../../src/core/events'
import { labelOf } from '../../src/core/views/labels'
import { isStuck, statusOf, stateOf, STUCK_REASONS, type StatusInput } from '../../src/core/views/status'
import { SAMPLES } from './fixtures'

const card = (kind: 'brief' | 'result' | 'question', reason: string) => ({ card: kind, reason, options: [], seq: 1 })

const base: StatusInput = { stage: 'build', waitingOn: 'agents', card: null, parked: null, hasRun: true, ended: null }

describe('stuck', () => {
  it('is a question card with reason failed-runs, verify-rounds or reporter-silent', () => {
    for (const reason of STUCK_REASONS) expect(isStuck(card('question', reason))).toBe(true)
    expect(STUCK_REASONS).toEqual(['failed-runs', 'verify-rounds', 'reporter-silent'])
  })

  it('is nothing else', () => {
    expect(isStuck(null)).toBe(false)
    expect(isStuck(card('question', 'disputed'))).toBe(false)
    expect(isStuck(card('question', 'production'))).toBe(false)
    expect(isStuck(card('brief', 'failed-runs'))).toBe(false)
  })
})

describe('state and status', () => {
  it('maps who has the turn to a state', () => {
    expect(stateOf({ waitingOn: 'owner', stuck: true, hasRun: false })).toBe('stuck')
    expect(stateOf({ waitingOn: 'owner', stuck: false, hasRun: false })).toBe('owner')
    expect(stateOf({ waitingOn: 'agents', stuck: false, hasRun: true })).toBe('agents')
    expect(stateOf({ waitingOn: 'agents', stuck: false, hasRun: false })).toBe('others')
    expect(stateOf({ waitingOn: 'reporter', stuck: false, hasRun: false })).toBe('others')
    expect(stateOf({ waitingOn: 'nobody', stuck: false, hasRun: false })).toBe('none')
  })

  it('names one status per situation', () => {
    const status = (extra: Partial<StatusInput>) => statusOf({ ...base, ...extra })
    expect(status({})).toBe('building')
    expect(status({ stage: 'verify', hasRun: false })).toBe('waiting-for-checks')
    expect(status({ stage: 'verify' })).toBe('verifying')
    expect(status({ stage: 'ship', hasRun: false })).toBe('waiting-for-deploy')
    expect(status({ waitingOn: 'reporter', stage: 'intake', hasRun: false })).toBe('reporter-asked')
    expect(status({ waitingOn: 'owner', card: card('brief', 'backlog') })).toBe('brief-needs-approval')
    expect(status({ waitingOn: 'owner', card: card('result', 'result') })).toBe('result-ready')
    expect(status({ waitingOn: 'owner', card: card('question', 'disputed') })).toBe('question')
    expect(status({ waitingOn: 'owner', card: card('question', 'verify-rounds') })).toBe('verify-rounds')
    expect(status({ waitingOn: 'nobody', parked: 'limit' })).toBe('parked')
    expect(status({ waitingOn: 'nobody', stage: 'done', ended: 'accepted' })).toBe('accepted')
    expect(status({ waitingOn: 'nobody', stage: 'done', ended: 'closed' })).toBe('closed')
  })
})

describe('event labels', () => {
  it('gives every event type a plain sentence', () => {
    for (const [type, data] of Object.entries(SAMPLES)) {
      const label = labelOf(parseEvent({ type, data }))
      expect(label, type).toMatch(/^[A-Z][^.]*\S$/)
      expect(label).not.toContain(type)
    }
  })

  it('says what happened', () => {
    expect(labelOf(parseEvent({ type: 'build.submitted', data: SAMPLES['build.submitted'] }))).toBe(
      'A patch was submitted as pull request #12',
    )
    expect(labelOf(parseEvent({ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }))).toBe(
      'The issue was closed on the forge',
    )
  })
})
