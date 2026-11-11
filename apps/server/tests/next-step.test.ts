import { describe, expect, it } from 'vitest'
import { NEEDS } from '../src/lib/needs-you'
import { actionFor, fallbackFor, nextStep } from '../src/lib/next-step'
import { DEFAULT } from '../src/lib/workflow'

const base = { wf: DEFAULT(), ticket: { state: 'open', stage: 'build' }, need: null, run: null, waiting: null, blockers: [], admin: true }

describe('nextStep', () => {
  it('is enabled on the owner\'s turn, labelled with the need', () => {
    expect(nextStep({ ...base, need: 'Approve plan' })).toMatchObject({ label: 'Approve plan', enabled: true })
    expect(nextStep({ ...base, need: 'Accept on staging', blockers: [{ id: 1, number: 9 }] }).enabled).toBe(true)
  })
  it('an open blocker beats a live Run and links the blocker', () => {
    const s = nextStep({ ...base, blockers: [{ id: 5, number: 339 }], run: { id: 7, stage: 'build', status: 'running' } })
    expect(s).toMatchObject({ enabled: false, reason: 'Blocked by #339.', links: [{ text: '#339', href: '/tickets/5' }] })
  })
  it('a live Run names the Run to an Admin only', () => {
    const run = { id: 735, stage: 'build', status: 'running' }
    expect(nextStep({ ...base, run })).toMatchObject({ reason: 'The factory is working on this (Run 735).', links: [{ text: 'Run 735', href: '/runs/735' }] })
    const member = nextStep({ ...base, run, admin: false })
    expect(member.reason).toBe('The factory is working on this.')
    expect(member.links).toEqual([])
  })
  it('a Run waiting for a session says it waits for an agent of the stage role, not that the factory works', () => {
    const run = { id: 1001, stage: 'build', status: 'awaiting_session' }
    const s = nextStep({ ...base, run })
    expect(s).toMatchObject({ label: 'Connect an agent', href: '/team', enabled: false, reason: 'Waiting for a Software engineer agent to pick this up (Run 1001).', links: [{ text: 'Run 1001', href: '/runs/1001' }] })
    expect(nextStep({ ...base, run, admin: false }).reason).toBe('Waiting for a Software engineer agent to pick this up.')
  })
  it('no connected agent of the role is said so', () => {
    expect(nextStep({ ...base, run: { id: 1001, stage: 'build', status: 'awaiting_session' }, connected: false })).toMatchObject({ href: '/team', reason: 'No Software engineer agent is connected (Run 1001).' })
  })
  it('a Run queued for the Runner says so', () => {
    const s = nextStep({ ...base, run: { id: 12, stage: 'build', status: 'queued' } })
    expect(s).toMatchObject({ label: 'Queued', enabled: false, reason: 'Queued for the Runner (Run 12).', links: [{ text: 'Run 12', href: '/runs/12' }] })
    expect(s.href).toBeUndefined()
  })
  it('an overlap hold names the holder', () => {
    const s = nextStep({ ...base, ticket: { stage: 'build', waitingFor: 'build', waitingReason: 'overlaps #356' }, waiting: 'Waiting: overlaps #356' })
    expect(s).toMatchObject({ enabled: false, reason: 'Queued for Build: waits for #356, which changes the same files. Starts by itself.' })
  })
  it('a full column and waiting checks', () => {
    expect(nextStep({ ...base, ticket: { stage: 'plan', waitingFor: 'build' }, waiting: 'Waiting: Build is full (2/2)' }).reason).toBe('Queued for Build: Build is full (2/2). Starts by itself.')
    expect(nextStep({ ...base, ticket: { stage: 'review', waitingFor: 'checks' }, waiting: 'Waiting for checks' }).reason).toBe('Waiting for the MR checks to finish. Review starts by itself.')
  })
  it('release, review, closed and idle say who is next', () => {
    expect(nextStep({ ...base, ticket: { stage: 'release', labels: [] } }).reason).toBe('The factory is waiting for the staging deploy.')
    expect(nextStep({ ...base, ticket: { stage: 'release', labels: ['bauherr:approved:staging'] } }).reason).toBe('The factory is releasing this.')
    expect(nextStep({ ...base, ticket: { stage: 'review', reviewState: 'waiting_checks' } }).reason).toBe('In review: review clean, waiting for checks to finish.')
    expect(nextStep({ ...base, ticket: { state: 'closed', stage: 'done' } }).label).toBe('Done')
    expect(nextStep(base).reason).toBe('The factory picks this up next.')
  })
  it('an escalated live Run says Escalated; a stopped Run the factory still retries is not the owner\'s', () => {
    const esc = { id: 9, stage: 'build', status: 'running', escalation: { step: 2, reason: 'the first attempt failed' } }
    expect(nextStep({ ...base, run: esc })).toMatchObject({ label: 'Escalated', enabled: false, reason: 'Escalated to the strong model (step 2 of 4): the first attempt failed (Run 9).', links: [{ text: 'Run 9', href: '/runs/9' }] })
    expect(nextStep({ ...base, run: esc, admin: false }).reason).toBe('Escalated to the strong model (step 2 of 4): the first attempt failed.')
    expect(nextStep({ ...base, run: { id: 9, stage: 'build', status: 'failed' } })).toMatchObject({ label: 'Escalating', enabled: false })
    expect(nextStep({ ...base, run: { id: 9, stage: 'plan', status: 'failed' } }).label).not.toBe('Escalating')
    expect(nextStep({ ...base, ticket: { stage: 'triage' }, run: { id: 9, stage: 'triage', status: 'cancelled' } }).label).not.toBe('Escalating')
    expect(nextStep({ ...base, need: 'Run failed', run: { id: 9, stage: 'build', status: 'failed' } })).toMatchObject({ label: 'Run failed', enabled: true })
  })
  it('never says there is nothing to do', () => {
    for (const ticket of [{ stage: 'plan' }, { stage: 'triage' }, { stage: 'review' }, { stage: 'release' }]) expect(nextStep({ ...base, ticket }).reason).not.toMatch(/nothing to do/i)
  })
})

describe('every need has exactly one button', () => {
  for (const need of NEEDS) {
    for (const run of [null, 7]) {
      for (const present of [true, false]) {
        it(`${need}, run ${run ?? 'absent'}, inputs ${present ? 'present' : 'missing'}`, () => {
          const ctx = { run, open: 2, product: 3, releaseRunUrl: present ? 'https://example.com/run/1' : null }
          if (actionFor(need, ctx)) return
          const fallback = fallbackFor(need)
          expect(fallback).toEqual({ label: `${need}: see details`, href: '#details' })
          expect(fallback.label).not.toMatch(/Run \d/)
        })
      }
    }
  }
})

describe('every Ticket or Run the reason names is linked', () => {
  const run = (status: string, extra = {}) => ({ id: 12, stage: 'build', status, ...extra })
  const cases = {
    blocked: { blockers: [{ id: 5, number: 339 }, { id: 6, number: 340 }] },
    overlap: { ticket: { stage: 'build', waitingFor: 'build', waitingReason: 'overlaps #356' }, waiting: 'Waiting: overlaps #356', holders: [{ id: 9, number: 356 }] },
    escalated: { run: run('running', { escalation: { step: 2, reason: 'x' } }) },
    working: { run: run('running') },
    awaiting: { run: run('awaiting_session') },
    runner: { run: run('queued') },
    escalating: { run: run('failed') },
    checks: { ticket: { stage: 'review', waitingFor: 'checks' }, waiting: 'Waiting for checks' },
    full: { ticket: { stage: 'plan', waitingFor: 'build' }, waiting: 'Waiting: Build is full (2/2)' },
    queued: {},
    staging: { ticket: { stage: 'release', labels: [] } },
    review: { ticket: { stage: 'review' } },
    done: { ticket: { state: 'closed', stage: 'done' } },
  }
  for (const [name, input] of Object.entries(cases)) {
    it(name, () => {
      const s = nextStep({ ...base, ...input })
      expect(s.enabled).toBe(false)
      for (const token of s.reason.match(/#\d+|Run \d+/g) ?? []) expect(s.links.map((l) => l.text)).toContain(token)
    })
  }
  it('names every blocker and the overlap holder', () => {
    expect(nextStep({ ...base, ...cases.blocked }).links).toEqual([{ text: '#339', href: '/tickets/5' }, { text: '#340', href: '/tickets/6' }])
    expect(nextStep({ ...base, ...cases.overlap }).links).toEqual([{ text: '#356', href: '/tickets/9' }])
  })
})
