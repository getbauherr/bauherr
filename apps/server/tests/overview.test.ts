import { fileURLToPath } from 'node:url'
import { GATES } from '../src/app/(app)/lib/gates'
import { describe, expect, it } from 'vitest'
import { heartbeatAge } from '../src/app/(app)/lib/format'
import { NEEDS, needsYou, releaseWord, stageOf } from '../src/app/(app)/lib/needs-you'
import { DEFAULT } from '../src/lib/workflow'

process.env.BAUHERR_PACK_DIR = fileURLToPath(new URL('./fixtures/gated-pack', import.meta.url))

const t = (stage: string | null, labels: string[] = []) => ({ stage, labels })
const r = (stage: string, status: string) => ({ stage, status })

describe('needsYou', () => {
  it('asks for the round cap only past the cap; a review the factory could not conclude below it reads Needs you', () => {
    const rev = (reviewState: string, reviewRounds: number) => ({ ...t('review'), reviewState, reviewRounds })
    expect(needsYou(DEFAULT(), rev('needs_human', 3), r('review', 'succeeded'))).toBe('Round cap reached')
    expect(needsYou(DEFAULT(), rev('needs_human', 2), r('review', 'succeeded'))).toBe('Needs you')
    expect(needsYou(DEFAULT(), rev('needs_human', 0), r('review', 'succeeded'))).toBe('Needs you')
    expect(needsYou(DEFAULT(), rev('waiting_checks', 3), r('review', 'succeeded'))).toBeNull()
  })

  it('asks for plan approval once a plan Run succeeded and no approval label exists', () => {
    expect(needsYou(DEFAULT(), t('plan'), r('plan', 'succeeded'))).toBe('Approve plan')
    expect(needsYou(DEFAULT(), t('plan', ['bauherr:approved:plan']), r('plan', 'succeeded'))).toBeNull()
    expect(needsYou(DEFAULT(), t('plan'), r('plan', 'running'))).toBeNull()
    expect(needsYou(DEFAULT(), t('plan'), null)).toBeNull()
  })
  it('asks for the decisions first while critical rows are unanswered', () => {
    expect(needsYou(DEFAULT(), t('plan'), r('plan', 'succeeded'), 1)).toBe('Answer decisions')
    expect(needsYou(DEFAULT(), t('plan', ['bauherr:approved:plan']), r('plan', 'succeeded'), 1)).toBeNull()
  })
  it('treats an in-progress plan Run as Plan in progress, not needs-you', () => {
    for (const status of ['running', 'queued', 'awaiting_session']) expect(needsYou(DEFAULT(), t('plan'), r('plan', status))).toBeNull()
  })
  it('flags needs_human and failed Runs in that order; review is the factory\'s, never needs-you', () => {
    expect(needsYou(DEFAULT(), t('build'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(DEFAULT(), t('review'), r('build', 'succeeded'))).toBeNull()
    expect(needsYou(DEFAULT(), t('review'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'failed'), reasonKind: 'decision' })).toBe('Run failed')
  })
  it('hides a failed Run until the escalation ladder ended, and a stuck needs_human Run always', () => {
    expect(needsYou(DEFAULT(), t('build'), r('build', 'failed'))).toBeNull()
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'failed'), reasonKind: 'stuck' })).toBeNull()
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'needs_human'), reasonKind: 'stuck' })).toBeNull()
    expect(needsYou(DEFAULT(), t('build'), { ...r('build', 'needs_human'), reasonKind: 'access' })).toBe('Run needs you')
  })
  it('asks to accept on staging once the deploy is observed, and flags a timeout', () => {
    const rel = (releaseState: string | null, labels: string[] = []) => ({ stage: 'release', labels, releaseState })
    expect(needsYou(DEFAULT(), rel('on_staging'), r('build', 'succeeded'))).toBe('Accept on staging')
    expect(needsYou(DEFAULT(), rel('timed_out'), r('build', 'succeeded'))).toBe('Staging not confirmed')
    expect(needsYou(DEFAULT(), rel('waiting'), r('build', 'succeeded'))).toBeNull()
    expect(needsYou(DEFAULT(), rel('on_staging', ['bauherr:approved:staging']), r('build', 'succeeded'))).toBeNull()
  })
  it('asks to approve production after staging acceptance and flags a failed deploy', () => {
    const rel = (productionState: string, labels: string[] = ['bauherr:approved:staging']) => ({ stage: 'release', labels, productionState })
    const run = r('build', 'succeeded')
    expect(needsYou(DEFAULT(), rel('awaiting_approval'), run)).toBe('Approve production')
    expect(needsYou(DEFAULT(), rel('deploying'), run)).toBeNull()
    expect(needsYou(DEFAULT(), rel('failed', ['bauherr:approved:staging', 'bauherr:approved:production']), run)).toBe('Production deploy failed')
    expect(needsYou(DEFAULT(), rel('timed_out'), run)).toBe('Production deploy failed')
    expect(needsYou(DEFAULT(), rel('deployed'), run)).toBeNull()
  })
  it('gives every needs-you value a Gate with an action', () => {
    for (const need of NEEDS) expect(GATES[need], need).toMatchObject({ kind: expect.stringMatching(/^(plan|questions|release|production|production-checks|release-failed|review-cap|rerun|back-to-build|cancelled|expedite|decision)$/), title: expect.any(String) })
  })
  it('gives every needs-you value a sentence and a verb for the action bar', () => {
    const ctx = { stage: 'build', missing: ['D2'], open: 1 }
    for (const need of NEEDS) {
      expect(GATES[need].sentence(ctx), need).toMatch(/\S/)
      expect(GATES[need].verb(ctx), need).toMatch(/\S/)
    }
    expect(GATES['Run failed'].verb(ctx)).toBe('Re-run build')
    expect(GATES['Answer decisions'].sentence(ctx)).toContain('D2')
  })
  it('words the production states', () => {
    expect(releaseWord(DEFAULT(), { stage: 'release', productionState: 'awaiting_approval', labels: ['bauherr:approved:staging'] })).toBe('awaiting production approval')
    expect(releaseWord(DEFAULT(), { stage: 'release', productionState: 'deploying' })).toBe('deploying')
    expect(releaseWord(DEFAULT(), { stage: 'done', state: 'closed', productionState: 'deployed' })).toBe('deployed')
  })
  it('words the release stage', () => {
    expect(releaseWord(DEFAULT(), { stage: 'release', releaseState: null })).toBe('waiting')
    expect(releaseWord(DEFAULT(), { stage: 'release', releaseState: 'on_staging' })).toBe('on staging')
    expect(releaseWord(DEFAULT(), { stage: 'release', releaseState: 'timed_out' })).toBe('timed out')
    expect(releaseWord(DEFAULT(), { stage: 'done', state: 'closed', labels: ['bauherr:approved:staging'] })).toBe('accepted')
    expect(releaseWord(DEFAULT(), { stage: 'done', state: 'closed' })).toBeNull()
    expect(releaseWord(DEFAULT(), { stage: 'build' })).toBeNull()
  })
  it('is quiet for healthy tickets and tickets without a stage', () => {
    expect(needsYou(DEFAULT(), t('build'), r('build', 'running'))).toBeNull()
    expect(needsYou(DEFAULT(), t(null), null)).toBeNull()
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

describe('parent stage', () => {
  it('is a Board stage that needs nothing from the Bauherr', () => {
    expect(stageOf(DEFAULT(), { stage: 'parent' })).toBe('parent')
    expect(stageOf(DEFAULT(), { stage: 'parent', state: 'closed' })).toBe('done')
    expect(needsYou(DEFAULT(), t('parent', ['bauherr:approved:plan']), null)).toBeNull()
  })
})

