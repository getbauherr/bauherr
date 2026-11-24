import { describe, expect, it } from 'vitest'
import type { Figures, TicketFacts } from '../../src/core/insights/figures'
import { farOffFigures, farOffTickets, isFigureFarOff } from '../../src/core/insights/outliers'

const ticket = (recordId: number, extra: Partial<TicketFacts> = {}): TicketFacts => ({
  recordId,
  doneAt: new Date('2026-04-01T00:00:00Z'),
  sendBacks: 0,
  verifyRounds: 1,
  failedRuns: 0,
  questions: 0,
  seconds: 3600,
  costUsd: 1,
  findings: { spec: 0, standards: 0, security: 0 },
  ...extra,
})

const figures = (extra: Partial<Figures> = {}): Figures => ({
  ticketsAccepted: 5,
  firstTryShare: 1,
  sendBacks: 0,
  verifyRoundsPerTicket: 1,
  failedRuns: 1,
  questions: 2,
  secondsToAccepted: 3600,
  costUsd: 10,
  findingsSpec: 0,
  findingsStandards: 0,
  findingsSecurity: 0,
  correctionsCameBack: 0,
  ...extra,
})

describe('far off tickets', () => {
  const usual = [1, 2, 3, 4, 5].map((id) => ticket(id))

  it('marks the one ticket with six verify rounds among tickets with one', () => {
    const marked = farOffTickets([...usual, ticket(6, { verifyRounds: 6 })])
    expect(marked).toEqual([{ recordId: 6, metric: 'verifyRounds', value: 6, limit: 2 }])
  })

  it('marks nothing in a sample without it, and gives the same marks for the same input', () => {
    expect(farOffTickets([...usual, ticket(6, { verifyRounds: 2 })])).toEqual([])
    const sample = [...usual, ticket(6, { verifyRounds: 6, failedRuns: 4 })]
    expect(farOffTickets(sample)).toEqual(farOffTickets([...sample]))
    expect(farOffTickets(sample).map((mark) => mark.metric)).toEqual(['verifyRounds', 'failedRuns'])
  })

  it('does not judge a ticket against fewer than three others', () => {
    expect(farOffTickets([ticket(1), ticket(2, { verifyRounds: 9 })])).toEqual([])
  })
})

describe('far off figures', () => {
  it('is above twice the median of the earlier ranges', () => {
    expect(isFigureFarOff(5, [2, 3, 1])).toBe(true)
    expect(isFigureFarOff(4, [2, 3, 1])).toBe(false)
    expect(isFigureFarOff(5, [2, null, 1, 3])).toBe(true)
  })

  it('needs earlier values above zero to compare with', () => {
    expect(isFigureFarOff(5, [])).toBe(false)
    expect(isFigureFarOff(5, [null])).toBe(false)
    expect(isFigureFarOff(5, [0, 0])).toBe(false)
    expect(isFigureFarOff(null, [1])).toBe(false)
  })

  it('names the figures that are far off', () => {
    const earlier = [figures(), figures(), figures()]
    expect(farOffFigures(figures({ failedRuns: 5, costUsd: 11 }), earlier)).toEqual(['failedRuns'])
    expect(farOffFigures(figures(), earlier)).toEqual([])
  })
})
