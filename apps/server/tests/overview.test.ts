import { GATES } from '../src/app/(app)/lib/gates'
import { describe, expect, it } from 'vitest'
import { heartbeatAge } from '../src/app/(app)/lib/format'
import { NEEDS, needsYou, releaseWord } from '../src/app/(app)/lib/needs-you'

const t = (stage: string | null, labels: string[] = []) => ({ stage, labels })
const r = (stage: string, status: string) => ({ stage, status })

describe('needsYou', () => {
  it('asks for plan approval once a plan Run succeeded and no approval label exists', () => {
    expect(needsYou(t('plan'), r('plan', 'succeeded'))).toBe('Approve plan')
    expect(needsYou(t('plan', ['bauherr:approved:plan']), r('plan', 'succeeded'))).toBeNull()
    expect(needsYou(t('plan'), r('plan', 'running'))).toBeNull()
    expect(needsYou(t('plan'), null)).toBeNull()
  })
  it('asks for the decisions first while critical rows are unanswered', () => {
    expect(needsYou(t('plan'), r('plan', 'succeeded'), 1)).toBe('Answer decisions')
    expect(needsYou(t('plan', ['bauherr:approved:plan']), r('plan', 'succeeded'), 1)).toBeNull()
  })
  it('treats an in-progress plan Run as Plan in progress, not needs-you', () => {
    for (const status of ['running', 'queued', 'awaiting_session']) expect(needsYou(t('plan'), r('plan', status))).toBeNull()
  })
  it('flags needs_human and failed Runs in that order; review is the factory\'s, never needs-you', () => {
    expect(needsYou(t('build'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(t('review'), r('build', 'succeeded'))).toBeNull()
    expect(needsYou(t('review'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(t('build'), r('build', 'failed'))).toBe('Run failed')
  })
  it('asks to accept on staging once the deploy is observed, and flags a timeout', () => {
    const rel = (releaseState: string | null, labels: string[] = []) => ({ stage: 'release', labels, releaseState })
    expect(needsYou(rel('on_staging'), r('build', 'succeeded'))).toBe('Accept on staging')
    expect(needsYou(rel('timed_out'), r('build', 'succeeded'))).toBe('Staging not confirmed')
    expect(needsYou(rel('waiting'), r('build', 'succeeded'))).toBeNull()
    expect(needsYou(rel('on_staging', ['bauherr:approved:staging']), r('build', 'succeeded'))).toBeNull()
  })
  it('gives every needs-you value a Gate with an action', () => {
    for (const need of NEEDS) expect(GATES[need], need).toMatchObject({ kind: expect.stringMatching(/^(plan|questions|release|rerun)$/), title: expect.any(String) })
  })
  it('words the release stage', () => {
    expect(releaseWord({ stage: 'release', releaseState: null })).toBe('waiting')
    expect(releaseWord({ stage: 'release', releaseState: 'on_staging' })).toBe('on staging')
    expect(releaseWord({ stage: 'release', releaseState: 'timed_out' })).toBe('timed out')
    expect(releaseWord({ stage: 'done', state: 'closed', labels: ['bauherr:approved:staging'] })).toBe('accepted')
    expect(releaseWord({ stage: 'done', state: 'closed' })).toBeNull()
    expect(releaseWord({ stage: 'build' })).toBeNull()
  })
  it('is quiet for healthy tickets and tickets without a stage', () => {
    expect(needsYou(t('build'), r('build', 'running'))).toBeNull()
    expect(needsYou(t(null), null)).toBeNull()
  })
})

describe('heartbeatAge', () => {
  const now = Date.parse('2026-01-01T00:10:00Z')
  it('formats seconds, minutes, hours and flags >5 min as stale', () => {
    expect(heartbeatAge('2026-01-01T00:09:20Z', now)).toEqual({ text: '40s ago', stale: false })
    expect(heartbeatAge('2026-01-01T00:05:00Z', now)).toEqual({ text: '5m ago', stale: false })
    expect(heartbeatAge('2026-01-01T00:04:00Z', now)).toEqual({ text: '6m ago', stale: true })
    expect(heartbeatAge('2025-12-31T21:00:00Z', now)).toEqual({ text: '3h ago', stale: true })
  })
})
