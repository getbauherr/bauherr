import { describe, expect, it } from 'vitest'
import { needsYou } from '../src/app/(app)/lib/needs-you'

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
  it('flags needs_human, review and failed Runs in that order', () => {
    expect(needsYou(t('build'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(t('review'), r('build', 'succeeded'))).toBe('Review MR')
    expect(needsYou(t('review'), r('build', 'needs_human'))).toBe('Run needs you')
    expect(needsYou(t('build'), r('build', 'failed'))).toBe('Run failed')
  })
  it('is quiet for healthy tickets and tickets without a stage', () => {
    expect(needsYou(t('build'), r('build', 'running'))).toBeNull()
    expect(needsYou(t(null), null)).toBeNull()
  })
})
