import { describe, expect, it } from 'vitest'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { fold } from '../../src/core/lifecycle'
import {
  checksFinished,
  issueClosed,
  pullMerged,
  react,
  reporterReplied,
  type ReactInput,
  type ReactItem,
} from '../../src/core/mirror/react'
import { briefed, ev, inBrief, inBuild, inShip, inVerify, start } from './fixtures'

const open: ReactItem = { state: 'open', headSha: null, mergeSha: null, baseRef: null, conflicts: false }
const pull = (extra: Partial<ReactItem> = {}): ReactItem => ({ ...open, headSha: 'h1', ...extra })
const ASKED = '2026-11-10T10:00:00Z'
const AFTER = '2026-11-11T10:00:00Z'

const input = (events: ReturnType<typeof ev>[], extra: Partial<ReactInput> = {}): ReactInput => ({
  record: briefed(),
  state: fold(events),
  postedAt: null,
  issue: open,
  pull: null,
  comments: [],
  checks: [],
  deploy: null,
  closeWritten: false,
  ...extra,
})

const waiting = [ev('intake.asked', { round: 1 })]
const reply = (extra: { author?: string; body?: string; createdAt?: string } = {}) => ({
  author: 'jo',
  body: 'here you go',
  createdAt: AFTER,
  ...extra,
})
const asking = (comments: ReturnType<typeof reply>[]) => input(waiting, { postedAt: ASKED, comments })

describe('reporterReplied', () => {
  it('fires on a newer comment of the reporter while waiting', () => {
    expect(reporterReplied(asking([reply()]))).toEqual([{ type: 'reporter.replied', data: {} }])
  })

  it.each([
    ['another person', { author: 'eve' }],
    ['the factory account', { body: `${DISCLOSURE}\n\nstatus` }],
    ['a comment from before the question', { createdAt: '2026-11-09T10:00:00Z' }],
  ])('ignores a comment of %s', (_name, extra) => {
    expect(reporterReplied(asking([reply(extra)]))).toEqual([])
  })

  it('does nothing when the ticket does not wait on the reporter', () => {
    const base = input([...waiting, ev('reporter.replied')], { postedAt: ASKED, comments: [reply()] })
    expect(reporterReplied(base)).toEqual([])
    expect(reporterReplied(input([], { comments: [reply()] }))).toEqual([])
  })
})

const verifying = (extra: Partial<ReactInput> = {}) =>
  input([...inVerify], { pull: pull(), checks: [{ status: 'completed', conclusion: 'success' }], ...extra })

describe('checksFinished', () => {
  it('fires passed when every check of the head commit succeeded', () => {
    expect(checksFinished(verifying())).toEqual([{ type: 'checks.finished', data: { patchId: 'p1', passed: true } }])
  })

  it('fires failed when one check did not conclude successfully', () => {
    const checks = [
      { status: 'completed', conclusion: 'success' },
      { status: 'completed', conclusion: 'failure' },
    ]
    expect(checksFinished(verifying({ checks }))).toEqual([
      { type: 'checks.finished', data: { patchId: 'p1', passed: false } },
    ])
  })

  it('accepts skipped and neutral checks as passing', () => {
    const checks = [
      { status: 'completed', conclusion: 'skipped' },
      { status: 'completed', conclusion: 'neutral' },
    ]
    expect(checksFinished(verifying({ checks }))[0]).toMatchObject({ data: { passed: true } })
  })

  it('waits while a check is not completed or none is reported', () => {
    const running = [{ status: 'completed', conclusion: 'success' }, { status: 'in_progress', conclusion: null }]
    expect(checksFinished(verifying({ checks: running }))).toEqual([])
    expect(checksFinished(verifying({ checks: [] }))).toEqual([])
  })

  it('waits when the pull request head is not the head of the patch', () => {
    expect(checksFinished(verifying({ pull: pull({ headSha: 'other' }) }))).toEqual([])
    expect(checksFinished(verifying({ pull: null }))).toEqual([])
  })

  it('does not repeat once the checks are recorded or when none are required', () => {
    const done = input([...inVerify, ev('checks.finished')], { pull: pull(), checks: verifying().checks })
    expect(checksFinished(done)).toEqual([])
    const none = { ...verifying(), state: fold(inVerify, { productionGate: false, requiredChecks: false }) }
    expect(checksFinished(none)).toEqual([])
  })
})

const shipping = (extra: Partial<ReactInput> = {}) =>
  input([...inShip], { pull: pull({ state: 'merged', mergeSha: 'm1' }), ...extra })

describe('pullMerged', () => {
  it('fires with the merge commit while shipping and not yet merged', () => {
    expect(pullMerged(shipping())).toEqual([{ type: 'ship.merged', data: { sha: 'm1' } }])
  })

  it('does nothing when merged is already recorded, the pull is open, or the commit is unknown', () => {
    const recorded = input([...inShip, ev('ship.merged')], { pull: pull({ state: 'merged', mergeSha: 'm1' }) })
    expect(pullMerged(recorded)).toEqual([])
    expect(pullMerged(shipping({ pull: pull() }))).toEqual([])
    expect(pullMerged(shipping({ pull: pull({ state: 'merged' }) }))).toEqual([])
  })

  it('does nothing outside the ship stage', () => {
    expect(pullMerged(input(inVerify, { pull: pull({ state: 'merged', mergeSha: 'm1' }) }))).toEqual([])
  })
})

const closedIssue: ReactItem = { ...open, state: 'closed' }

describe('issueClosed', () => {
  it('fires closed-on-forge for an issue closed by someone else', () => {
    expect(issueClosed(input(inBrief, { issue: closedIssue }))).toEqual([
      { type: 'ticket.closed', data: { reason: 'closed-on-forge' } },
    ])
  })

  it('does nothing for an open issue, a closed ticket, or a ticket past the merge', () => {
    expect(issueClosed(input(inBrief))).toEqual([])
    expect(issueClosed(input([...inBrief, ev('ticket.closed')], { issue: closedIssue }))).toEqual([])
    const closedByUs = input([...inBrief, ev('intake.closed', { reason: 'duplicate' })], { issue: closedIssue })
    expect(issueClosed(closedByUs)).toEqual([])
    expect(issueClosed(input(inShip, { issue: closedIssue }))).toEqual([])
  })
})

describe('issueReopened', () => {
  const archived = [...inBuild, ev('ticket.closed', { reason: 'archived' })]

  it('restores an archived ticket whose closed issue is open again', () => {
    expect(react(input(archived, { closeWritten: true }))).toEqual([{ type: 'ticket.restored', data: {} }])
  })

  it('leaves an archived ticket alone while the issue is closed or the factory wrote no close', () => {
    expect(react(input(archived, { closeWritten: true, issue: closedIssue }))).toEqual([])
    expect(react(input(archived))).toEqual([])
  })

  it('reacts to nothing else on an archived ticket', () => {
    const merged = pull({ state: 'merged', mergeSha: 'm1' })
    expect(react(input(archived, { closeWritten: true, issue: closedIssue, pull: merged }))).toEqual([])
  })
})

describe('react', () => {
  it('returns only the close when the issue was closed, whatever else changed', () => {
    const closing = input(waiting, { postedAt: ASKED, comments: [reply()], issue: closedIssue })
    expect(react(closing)).toEqual([{ type: 'ticket.closed', data: { reason: 'closed-on-forge' } }])
  })

  it('collects the events of every reaction that applies', () => {
    expect(react(asking([reply()]))).toEqual([{ type: 'reporter.replied', data: {} }])
    expect(react(verifying())).toHaveLength(1)
    expect(react(input([start('intake')]))).toEqual([])
  })
})

describe('reactions of an adopted ticket', () => {
  const adoptedEvents = [
    ev('pull.adopted', { pr: 12, headSha: 'h1', patchId: 'adopted:h1' }),
    ev('intake.accepted'),
    ev('brief.approved'),
    ev('checks.finished', { patchId: 'adopted:h1' }),
  ]
  const adopted = (extra: Partial<ReactInput> = {}) => input(adoptedEvents, extra)

  it('appends a new pull.adopted when the head commit of an open pull request changed', () => {
    expect(react(adopted({ pull: pull({ headSha: 'h2' }) }))).toEqual([
      { type: 'pull.adopted', data: { pr: 12, headSha: 'h2', patchId: 'adopted:h2' } },
    ])
  })

  it('does nothing while the head commit is the adopted one, or the pull request is gone', () => {
    expect(react(adopted({ pull: pull() }))).toEqual([])
    expect(react(adopted({ pull: null }))).toEqual([])
  })

  it('does not react to a moved head of an ordinary ticket', () => {
    expect(react(input(inVerify, { pull: pull({ headSha: 'other' }) }))).toEqual([])
  })

  it('closes the ticket when the pull request was closed without a merge', () => {
    expect(react(adopted({ pull: pull({ state: 'closed' }) }))).toEqual([
      { type: 'ticket.closed', data: { reason: 'closed-on-forge' } },
    ])
    expect(react(input(inVerify, { pull: pull({ state: 'closed' }) }))).toEqual([])
  })

  it('counts a merge by a person as merged at Verify, and the closed issue does not close the ticket', () => {
    const merged = pull({ state: 'merged', mergeSha: 'm1' })
    const closedIssue = { ...open, state: 'closed' as const }
    expect(react(adopted({ pull: merged, issue: closedIssue }))).toEqual([
      { type: 'ship.merged', data: { sha: 'm1' } },
    ])
  })

  it('does not take a merge at Verify for an ordinary ticket', () => {
    expect(pullMerged(input(inVerify, { pull: pull({ state: 'merged', mergeSha: 'm1' }) }))).toEqual([])
  })

  it('still closes an adopted ticket when the issue is closed without the pull request being merged', () => {
    expect(issueClosed(adopted({ pull: pull(), issue: { ...open, state: 'closed' } }))).toHaveLength(1)
  })
})
