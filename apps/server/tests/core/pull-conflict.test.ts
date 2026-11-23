import { describe, expect, it } from 'vitest'
import { conflictNote } from '../../src/core/conflict-note'
import { renderStatus } from '../../src/core/forge/status'
import { fold, next } from '../../src/core/lifecycle'
import { pullConflicted, react, type ReactInput, type ReactItem } from '../../src/core/mirror/react'
import { adoptEvent, adoptedSource, briefed, CONFIG, ev, inShip, inVerify, reviewed, start } from './fixtures'

const NOTE = conflictNote('main')

const conflicted = ev('pull.conflicted')
const checksPending = [...inVerify]
const withReview = [...inVerify, reviewed]
const reviewing = [...inVerify, start('verify', 'r2')]
const verifying = [...inVerify, reviewed, ev('checks.finished'), start('verify', 'r3')]
const mine = briefed()

describe('pull.conflicted in the fold', () => {
  it.each([
    ['checks pending', checksPending],
    ['a live review run', reviewing],
    ['a review waiting for the checks', withReview],
    ['a live verifier run', verifying],
    ['Ship before the merge', inShip],
  ])('sends the ticket to Build with the note: %s', (_name, events) => {
    const before = fold(events)
    const state = fold([...events, conflicted])
    expect(state).toMatchObject({
      stage: 'build',
      reviewed: null,
      verdict: null,
      accepted: false,
      note: NOTE,
      verifyRounds: before.verifyRounds,
      conflict: { patchId: 'p1', base: 'main' },
    })
  })

  it('does not count a verify round', () => {
    const second = [...inVerify, ev('verify.changes'), start('build', 'r4'), ev('build.submitted', { patchId: 'p2' })]
    expect(fold(second).verifyRounds).toBe(1)
    expect(fold([...second, ev('pull.conflicted', { patchId: 'p2' })]).verifyRounds).toBe(1)
  })

  it('ignores a patch that is not the current one', () => {
    const state = fold([...inVerify, ev('pull.conflicted', { patchId: 'old' })])
    expect(state).toEqual({ ...fold(inVerify), last: 'pull.conflicted' })
  })

  it('asks the builder again, and a new patch clears the conflict', () => {
    const state = fold([...inVerify, conflicted])
    expect(next(mine, state, CONFIG)).toEqual({ kind: 'run', stage: 'build', role: 'builder' })
    const rebuilt = [start('build', 'r5'), ev('build.submitted', { patchId: 'p2', runId: 'r5' })]
    const again = fold([...inVerify, conflicted, ...rebuilt])
    expect(again).toMatchObject({ stage: 'verify', conflict: null, reviewed: null })
    expect(next(mine, again, CONFIG)).toEqual({ kind: 'run', stage: 'verify', role: 'reviewer' })
  })

  it('leaves an adopted pull request in Verify, waiting on the author', () => {
    const adopted = [adoptEvent(), ev('intake.accepted'), ev('brief.approved')]
    const checked = [...adopted, ev('checks.finished', { patchId: 'adopted:h1' })]
    const state = fold([...checked, ev('pull.conflicted', { patchId: 'adopted:h1' })])
    expect(state).toMatchObject({ stage: 'verify', adopted: true, waitingAuthor: true, note: null, verifyRounds: 0 })
    expect(next(briefed({ source: adoptedSource }), state, CONFIG)).toEqual({ kind: 'wait', on: 'author' })
    const pushed = fold([...checked, ev('pull.conflicted', { patchId: 'adopted:h1' }), adoptEvent('h2')])
    expect(pushed).toMatchObject({ waitingAuthor: false, conflict: null })
  })
})

const open: ReactItem = { state: 'open', headSha: 'h1', mergeSha: null, baseRef: 'main', conflicts: true }
const input = (events: ReturnType<typeof ev>[], pull: ReactItem | null = open): ReactInput => ({
  record: mine,
  state: fold(events),
  postedAt: null,
  issue: { ...open, headSha: null, baseRef: null, conflicts: false },
  pull,
  comments: [],
  checks: [],
  deploy: null,
  closeWritten: false,
})

describe('pullConflicted', () => {
  const event = { type: 'pull.conflicted', data: { patchId: 'p1', base: 'main' } }

  it('names the patch and the base in Verify and in Ship before the merge', () => {
    expect(pullConflicted(input(inVerify))).toEqual([event])
    expect(pullConflicted(input(inShip))).toEqual([event])
    expect(react(input(inVerify))).toEqual([event])
  })

  it('does not emit twice for the same patch', () => {
    expect(pullConflicted(input([...inVerify, conflicted]))).toEqual([])
  })

  it('does nothing without a conflict, for another head, after the merge, or outside Verify and Ship', () => {
    expect(pullConflicted(input(inVerify, { ...open, conflicts: false }))).toEqual([])
    expect(pullConflicted(input(inVerify, { ...open, headSha: 'other' }))).toEqual([])
    expect(pullConflicted(input(inVerify, null))).toEqual([])
    expect(pullConflicted(input([...inShip, ev('ship.merged')]))).toEqual([])
    expect(pullConflicted(input([...inVerify.slice(0, 4)]))).toEqual([])
  })
})

describe('the status comment', () => {
  it('says the branch conflicts only when asked', () => {
    const base = { record: mine, stage: 'verify' as const, pr: 12, changedAt: null }
    expect(renderStatus(base)).not.toContain('conflicts')
    const text = renderStatus({ ...base, conflict: 'main' })
    expect(text).toContain('**Waiting on the author:** the branch conflicts with main.')
  })
})
