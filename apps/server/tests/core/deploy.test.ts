import { describe, expect, it } from 'vitest'
import { commitChecksUrl, deployOverdue, deploySince, type DeployCheck, type DeployWait } from '../../src/core/deploy'
import type { AppEvent } from '../../src/core/events'
import { fold } from '../../src/core/lifecycle'
import { deployFinished, react, type ReactInput } from '../../src/core/mirror/react'
import type { StoredEvent } from '../../src/core/record/store'
import { briefed, ev, merged } from './fixtures'

const SINCE = '2026-11-20T10:00:00Z'
const BEFORE = '2026-11-20T09:59:00Z'
const AFTER = '2026-11-20T10:05:00Z'
const MINUTE = 60_000
const at = (offset: number) => new Date(Date.parse(SINCE) + offset)

const check = (name: string, conclusion: string | null, updatedAt = AFTER, status = 'completed'): DeployCheck => ({
  name,
  status: conclusion === null ? 'in_progress' : status,
  conclusion,
  updatedAt,
})

const wait = (checks: DeployCheck[], extra: Partial<DeployWait> = {}): DeployWait => ({
  names: ['deploy'],
  since: SINCE,
  limitMinutes: 60,
  now: at(MINUTE),
  checks,
  ...extra,
})

const input = (deploy: DeployWait | null): ReactInput => ({
  record: briefed(),
  state: fold(merged),
  postedAt: null,
  issue: { state: 'open', headSha: null, mergeSha: null },
  pull: null,
  comments: [],
  checks: [],
  deploy,
  closeWritten: false,
})

const deployed: AppEvent = { type: 'ship.deployed', data: {} }
const stalled = (reason: 'failed' | 'overdue', checks: string[]): AppEvent => ({
  type: 'ship.deploy-stalled',
  data: { reason, checks },
})

describe('deployFinished', () => {
  it('deploys when every named check completed successfully', () => {
    const deploy = wait([check('deploy', 'success'), check('smoke', 'success')], { names: ['deploy', 'smoke'] })
    expect(deployFinished(input(deploy))).toEqual([deployed])
  })

  it('stalls as failed with the names of the checks that failed', () => {
    const deploy = wait([check('deploy', 'failure'), check('smoke', 'success')], { names: ['deploy', 'smoke'] })
    expect(deployFinished(input(deploy))).toEqual([stalled('failed', ['deploy'])])
  })

  it('does nothing while a named check has no result or is still running', () => {
    expect(deployFinished(input(wait([])))).toEqual([])
    expect(deployFinished(input(wait([check('deploy', null)])))).toEqual([])
  })

  it('ignores a check that is not named', () => {
    expect(deployFinished(input(wait([check('lint', 'failure'), check('deploy', 'success')])))).toEqual([deployed])
    expect(deployFinished(input(wait([check('lint', 'success')])))).toEqual([])
  })

  it('does not raise a failure that was seen before the owner chose to check again', () => {
    expect(deployFinished(input(wait([check('deploy', 'failure', BEFORE)])))).toEqual([])
  })

  it('raises a later result of the same check as a new fact', () => {
    expect(deployFinished(input(wait([check('deploy', 'failure', AFTER)])))).toEqual([stalled('failed', ['deploy'])])
    expect(deployFinished(input(wait([check('deploy', 'success', AFTER)])))).toEqual([deployed])
  })

  it('does nothing when the ticket does not wait on its deploy', () => {
    expect(deployFinished(input(null))).toEqual([])
    expect(react(input(null))).toEqual([])
  })

  it('is part of react', () => {
    expect(react(input(wait([check('deploy', 'success')])))).toEqual([deployed])
  })

  it('stalls as overdue at the limit, naming the checks without a result', () => {
    const checks = [check('smoke', 'success')]
    const at60 = wait(checks, { names: ['deploy', 'smoke'], now: at(60 * MINUTE) })
    expect(deployFinished(input(at60))).toEqual([stalled('overdue', ['deploy'])])
  })

  it('waits one minute before the limit', () => {
    expect(deployFinished(input(wait([], { now: at(59 * MINUTE) })))).toEqual([])
  })

  it('names a failure seen before the answer as missing when the limit is reached', () => {
    const old = wait([check('deploy', 'failure', BEFORE)], { now: at(60 * MINUTE) })
    expect(deployFinished(input(old))).toEqual([stalled('overdue', ['deploy'])])
  })

  it('lets a failure win over a late limit', () => {
    const deploy = wait([check('deploy', 'failure')], { now: at(90 * MINUTE) })
    expect(deployFinished(input(deploy))).toEqual([stalled('failed', ['deploy'])])
  })
})

describe('deployOverdue', () => {
  it('counts from the given instant in minutes', () => {
    expect(deployOverdue(SINCE, at(59 * MINUTE + 59_999), 60)).toBe(false)
    expect(deployOverdue(SINCE, at(60 * MINUTE), 60)).toBe(true)
  })
})

const stored = (event: AppEvent, createdAt: string): StoredEvent => ({
  ...event,
  id: 1,
  recordId: 1,
  actor: 'factory',
  actorId: null,
  createdAt,
})

describe('deploySince', () => {
  const T1 = '2026-11-20T10:00:00Z'
  const T2 = '2026-11-20T11:00:00Z'
  const T3 = '2026-11-20T12:00:00Z'

  it('starts at the merge', () => {
    expect(deploySince([stored(ev('run.started'), T1), stored(ev('ship.merged'), T2)])).toBe(T2)
  })

  it('starts again when the owner chose to check again', () => {
    const events = [stored(ev('ship.merged'), T1), stored(ev('question.answered', { option: 'check-again' }), T3)]
    expect(deploySince(events)).toBe(T3)
  })

  it('is not moved by other answers', () => {
    const events = [stored(ev('ship.merged'), T1), stored(ev('question.answered', { option: 'retry' }), T3)]
    expect(deploySince(events)).toBe(T1)
  })

  it('starts at the accept of an adopted ticket merged by a person', () => {
    const events = [stored(ev('ship.merged'), T1), stored(ev('result.accepted'), T2)]
    expect(deploySince(events)).toBe(T2)
  })

  it('is null before the merge', () => {
    expect(deploySince([])).toBeNull()
  })
})

describe('commitChecksUrl', () => {
  it('points at the checks of the merge commit on each forge', () => {
    expect(commitChecksUrl('github', 'https://github.com/acme/app/pull/12', 'abc')).toBe(
      'https://github.com/acme/app/commit/abc/checks',
    )
    expect(commitChecksUrl('gitlab', 'https://gitlab.com/acme/app/-/merge_requests/12', 'abc')).toBe(
      'https://gitlab.com/acme/app/-/commit/abc/pipelines',
    )
  })
})
