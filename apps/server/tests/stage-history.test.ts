import { describe, expect, it } from 'vitest'
import { checkLines, reachedStages, stageHistory } from '../src/app/(app)/lib/stage-history'

const run = (stage: string, over = {}) => ({ id: 1, stage, status: 'succeeded', mode: 'autonomous', createdAt: '2026-01-01T00:00:00Z', startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:01:05Z', costUsd: 0.5, ...over })
const input = { runs: [] as any[], plan: null, decisions: [], answers: {}, mr: null, stagingSummary: null, accepted: false, production: null }

describe('reachedStages', () => {
  it('is every stage up to the current one', () => {
    expect(reachedStages({ stage: 'build' }, [])).toEqual(['triage', 'plan', 'build'])
  })
  it('adds a later stage that has a Run (sent back to build)', () => {
    expect(reachedStages({ stage: 'build' }, [{ stage: 'review' }])).toEqual(['triage', 'plan', 'build', 'review'])
  })
  it('a closed Ticket reached all, an epic none', () => {
    expect(reachedStages({ state: 'closed', stage: 'build' }, [])).toHaveLength(6)
    expect(reachedStages({ stage: 'parent' }, [])).toEqual([])
  })
})

describe('stageHistory', () => {
  it('lists only the Runs of the stage with duration, cost and the error as reason', () => {
    const h = stageHistory('build', { ...input, runs: [run('plan'), run('build', { id: 2, status: 'needs_human', error: 'No checks configured' })] })
    expect(h.runs).toMatchObject([{ id: 2, status: 'needs_human', reason: 'No checks configured', duration: '1m 5s', costUsd: 0.5 }])
  })
  it('plan: the plan and the decisions with their answers', () => {
    const h = stageHistory('plan', { ...input, plan: '# Plan', decisions: [{ id: 'D1', title: 'Q1' }, { id: 'D2', title: 'Q2' }], answers: { D1: 'yes' } })
    expect(h.plan).toEqual({ markdown: '# Plan', decisions: [{ id: 'D1', title: 'Q1', answer: 'yes' }, { id: 'D2', title: 'Q2', answer: null }] })
    expect(h.mr).toBeUndefined()
  })
  it('build: the MR with its checks', () => {
    const mr = { url: 'u', headSha: 'abc1234', checks: checkLines([{ name: 'ci', status: 'completed', conclusion: 'failure' }, { name: 'e2e', status: 'in_progress', conclusion: null }, { name: 'lint', status: 'completed', conclusion: 'success' }]) }
    expect(stageHistory('build', { ...input, mr }).mr?.checks).toEqual([{ name: 'ci', state: 'failed' }, { name: 'e2e', state: 'pending' }, { name: 'lint', state: 'passed' }])
  })
  it('review: one line per review round with the findings count', () => {
    const h = stageHistory('review', { ...input, runs: [run('review', { verdict: 'changes', findings: [{}, {}], reviewedSha: 'abc' }), run('review', { verdict: null })] })
    expect(h.reviews).toEqual([{ verdict: 'changes', findings: 2, sha: 'abc' }])
  })
  it('release and done: summary, acceptance and production', () => {
    const r = { ...input, stagingSummary: 'ok', accepted: true, production: 'deployed' }
    expect(stageHistory('release', r).release).toEqual({ summary: 'ok', accepted: true, production: 'deployed' })
    expect(stageHistory('done', r).release).toBeDefined()
    expect(stageHistory('triage', r).release).toBeUndefined()
  })
})
