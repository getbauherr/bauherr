import { describe, expect, it } from 'vitest'
import { aggregate, type Row } from '../src/app/(app)/lib/cost'
import { DEFAULT } from '../src/lib/workflow'

const row = (o: Partial<Row>): Row => ({ run: null, group: 'Runner', executor: 'runner', ticket: null, number: null, ticketTitle: null, stage: null, role: null, model: 'unknown', source: 'gateway', tokens: 10, cache: 0, cost: 0.5, at: '2026-01-01T00:00:00Z', ...o })

describe('aggregate: every breakdown adds up to the total', () => {
  const rows = [
    row({ run: 1, stage: 'build', role: 'engineer', model: 'claude-opus-5-5', source: 'session-reported', executor: 'session', group: 'eng-1', cost: 1 }),
    row({ run: 2, stage: 'build', cost: 0.25 }),
    row({ run: 3, stage: 'review', role: 'reviewer', model: 'claude-opus-5-5', cost: 0.125 }),
    row({ source: 'chat', executor: 'chat', group: 'Chat', model: 'claude-haiku-5-5', cost: 0.0625 }),
    row({ run: 5, cost: 0.03125 }),
    row({ run: 4, stage: 'build', role: 'engineer', model: 'x-unpriced', cost: null }),
  ]
  const c = aggregate(DEFAULT(), rows, { ids: [], rows: [] }, [])
  const sum = (ls: { costUsd: number }[]) => ls.reduce((a, l) => a + l.costUsd, 0)

  it('by model, role, session and stage', () => {
    expect(c.totalUsd).toBeCloseTo(1.46875)
    for (const ls of [c.byModel, c.byRole, c.bySession, c.byStage]) expect(sum(ls)).toBeCloseTo(c.totalUsd)
    for (const ls of [c.byModel, c.byRole, c.bySession, c.byStage]) expect(ls.reduce((a, l) => a + l.tokens, 0)).toBe(c.tokens)
  })
  it('names usage without a role, stage or model by what it is', () => {
    expect(c.byRole.map((l) => l.label)).toEqual(expect.arrayContaining(['Chat', 'Runner, no role']))
    expect(c.byStage.map((l) => l.label)).toEqual(expect.arrayContaining(['Chat', 'No stage']))
    expect(c.byModel.find((l) => l.key === 'unknown')).toMatchObject({ label: 'Not recorded', hint: 'Runs from before models were recorded' })
    expect(c.byModel.find((l) => l.key === 'x-unpriced')).toMatchObject({ unpriced: 1 })
  })
})
