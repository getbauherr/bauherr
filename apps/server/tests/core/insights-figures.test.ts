import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rangeFigures } from '../../src/core/insights/figures'
import { rangeReport } from '../../src/core/insights/report'
import { openCoreDb, type CoreDb } from './db'
import { DAY, seedTicket, type SeedTicket } from './figures-seed'

let db: CoreDb
let second: number
const NOW = new Date('2026-06-01T12:00:00Z')
const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
const range = { from: ago(10), to: NOW }

beforeAll(async () => {
  db = await openCoreDb('core_insights_figures')
  const data = { name: 'second', slug: 'second', workspace: db.workspace }
  second = Number((await db.payload.create({ collection: 'products', data, overrideAccess: true })).id)
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

const filter = () => ({ workspace: db.workspace, product: db.product, range })

const SIX: SeedTicket[] = [
  {
    doneAt: ago(1),
    startedMinutesBefore: 120,
    rounds: 1,
    runs: [{ cost: 1.5 }, { status: 'failed' }],
    findings: ['spec', 'spec'],
  },
  {
    doneAt: ago(2),
    startedMinutesBefore: 60,
    rounds: 1,
    sendBacks: 1,
    questions: 1,
    runs: [{ cost: 2 }],
    findings: ['security'],
  },
  { doneAt: ago(3), startedMinutesBefore: 180, runs: [{ status: 'failed' }, { status: 'failed', cost: 0.5 }] },
  {
    doneAt: ago(4),
    startedMinutesBefore: 30,
    rounds: 2,
    questions: 2,
    runs: [{ cost: 1 }],
    findings: ['standards', 'spec'],
  },
  { doneAt: ago(5), startedMinutesBefore: 90, rounds: 1, sendBacks: 2, findings: ['standards'] },
  {
    doneAt: ago(6),
    startedMinutesBefore: 240,
    rounds: 1,
    runs: [{ cost: 0.25 }],
    findings: ['security', 'security', 'spec'],
  },
]
const BEFORE: SeedTicket[] = [
  { doneAt: ago(12), rounds: 1, runs: [{ cost: 1 }] },
  { doneAt: ago(15), rounds: 3, sendBacks: 1, runs: [{ cost: 3 }], findings: ['spec'] },
]

describe('the figures of a range', () => {
  beforeAll(async () => {
    for (const sample of [...SIX, ...BEFORE]) await seedTicket(db, sample)
    await seedTicket(db, { doneAt: ago(1), rounds: 9, product: second })
    await seedTicket(db, { doneAt: NOW, rounds: 9 })
    await seedTicket(db, { doneAt: new Date(NOW.getTime() + DAY), rounds: 9 })
  })

  it('matches a hand count for six sample tickets', async () => {
    const { figures } = await rangeFigures(db.payload, filter())
    const value = Object.fromEntries(Object.entries(figures).map(([key, figure]) => [key, figure.value]))
    expect(value).toEqual({
      ticketsAccepted: 6,
      firstTryShare: 4 / 6,
      sendBacks: 3,
      verifyRoundsPerTicket: 1,
      failedRuns: 3,
      questions: 3,
      secondsToAccepted: 105 * 60,
      costUsd: 5.25,
      findingsSpec: 4,
      findingsStandards: 2,
      findingsSecurity: 3,
    })
  })

  it('counts every product of the workspace when none is given', async () => {
    const all = await rangeFigures(db.payload, { workspace: db.workspace, range })
    expect(all.figures.ticketsAccepted.value).toBe(7)
  })

  it('gives each figure with the figure of the range before', async () => {
    const { figures } = await rangeFigures(db.payload, filter())
    expect(figures.ticketsAccepted.previous).toBe(2)
    expect(figures.sendBacks.previous).toBe(1)
    expect(figures.verifyRoundsPerTicket.previous).toBe(2)
    expect(figures.firstTryShare.previous).toBe(0.5)
    expect(figures.costUsd.previous).toBe(4)
    expect(figures.findingsSpec.previous).toBe(1)
  })

  it('has no previous value for the first range', async () => {
    const first = { from: ago(20), to: ago(10) }
    const { figures, tickets } = await rangeFigures(db.payload, { ...filter(), range: first })
    expect(tickets).toHaveLength(2)
    expect(Object.values(figures).every((figure) => figure.previous === null)).toBe(true)
    expect(figures.ticketsAccepted.value).toBe(2)
  })

  it('has no figures to compare for a range without tickets', async () => {
    const { figures } = await rangeFigures(db.payload, { ...filter(), range: { from: ago(90), to: ago(80) } })
    expect(figures.ticketsAccepted.value).toBe(0)
    expect(figures.firstTryShare.value).toBeNull()
    expect(figures.secondsToAccepted.value).toBeNull()
  })
})

describe('the report of a range', () => {
  it('marks no ticket in the sample and gives the same marks every time', async () => {
    const first = await rangeReport(db.payload, filter())
    expect(first.farOff).toEqual({ figures: ['ticketsAccepted', 'sendBacks', 'findingsSpec'], tickets: [] })
    expect(await rangeReport(db.payload, filter())).toEqual(first)
  })

  it('marks the ticket with six verify rounds and the figures far above earlier ranges', async () => {
    const week = { from: ago(100), to: ago(93) }
    for (const days of [99, 98, 97, 96, 95]) await seedTicket(db, { doneAt: ago(days), rounds: 1 })
    await seedTicket(db, { doneAt: ago(94), rounds: 6 })
    for (const days of [107, 106]) await seedTicket(db, { doneAt: ago(days), rounds: 1 })
    const report = await rangeReport(db.payload, { ...filter(), range: week })
    expect(report.farOff.tickets).toEqual([
      expect.objectContaining({ metric: 'verifyRounds', value: 6, limit: 2 }),
    ])
    expect(report.farOff.figures).toContain('ticketsAccepted')
  })
})

describe('the speed of the figures', () => {
  it('computes a range of 100 tickets in under a second', async () => {
    const big = { from: ago(400), to: ago(300) }
    for (let i = 0; i < 100; i++) {
      const runs = [{ cost: 1 }, { status: 'failed' }]
      await seedTicket(db, { doneAt: ago(300 + i + 0.5), rounds: i % 3, runs, findings: ['spec'] })
    }
    const started = performance.now()
    const report = await rangeReport(db.payload, { ...filter(), range: big })
    const elapsed = performance.now() - started
    expect(report.tickets).toHaveLength(100)
    expect(elapsed).toBeLessThan(1000)
  }, 120_000)
})
