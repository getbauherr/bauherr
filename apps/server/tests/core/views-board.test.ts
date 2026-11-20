import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { board } from '../../src/core/views/board'
import { stageStats } from '../../src/core/views/stats'
import { openViews, seed, type Seeded } from './views-harness'

let s: Seeded
const now = () => new Date()

beforeAll(async () => {
  s = await seed(await openViews('core_views_board'))
}, 240_000)
afterAll(async () => {
  await s?.e.drop()
})

const ids = (cards: { recordId: number }[]) => cards.map((c) => c.recordId)
const view = async () => board(s.e.db.payload, { workspace: s.e.db.workspace, now: now() })

describe('board', () => {
  it('puts every ticket in its stage with status, state and who has the turn', async () => {
    const { stages, parked } = await view()
    const n = s.names
    const rows = (cards: typeof stages.intake) => cards.map((c) => [c.recordId, c.status, c.state])
    expect(rows(stages.intake)).toEqual(
      expect.arrayContaining([
        [n.intakeQueued, 'triaging', 'agents'],
        [n.intakeWorking, 'triaging', 'agents'],
        [n.reporterAsked, 'reporter-asked', 'others'],
        [n.failedRuns, 'failed-runs', 'stuck'],
        [n.reporterSilent, 'reporter-silent', 'stuck'],
      ]),
    )
    expect(stages.intake).toHaveLength(5)
    expect(rows(stages.brief)).toEqual(
      expect.arrayContaining([
        [n.briefQueued, 'drafting-brief', 'agents'],
        [n.briefCard, 'brief-needs-approval', 'owner'],
      ]),
    )
    expect(stages.brief).toHaveLength(2)
    expect(rows(stages.build)).toEqual(
      expect.arrayContaining([[n.building, 'building', 'agents'], [n.verifyRounds, 'verify-rounds', 'stuck']]),
    )
    expect(rows(stages.verify)).toEqual(
      expect.arrayContaining([[n.waitingChecks, 'waiting-for-checks', 'others'], [n.verifying, 'verifying', 'agents']]),
    )
    expect(rows(stages.ship)).toEqual([[n.resultCard, 'result-ready', 'owner']])
    expect(rows(stages.done)).toEqual(
      expect.arrayContaining([[n.accepted, 'accepted', 'none'], [n.closed, 'closed', 'none']]),
    )
    expect(ids(parked)).toEqual([n.parked])
    expect(parked[0]).toMatchObject({ status: 'parked', state: 'none', stage: 'brief' })
  })

  it('names the title from the mirror, the claimed run and the verify round', async () => {
    const { stages } = await view()
    const working = stages.intake.find((c) => c.recordId === s.names.intakeWorking)
    const run = { role: 'builder', leasedBy: 'worker-1' }
    expect(working).toMatchObject({ title: `Ticket ${working?.number}`, run })
    const queued = stages.intake.find((c) => c.recordId === s.names.intakeQueued)
    expect(queued?.run).toEqual({ role: 'builder', leasedBy: null })
    const rounds = stages.build.find((c) => c.recordId === s.names.verifyRounds)
    expect(rounds?.detail).toBe('Round 3')
    const asked = stages.intake.find((c) => c.recordId === s.names.reporterAsked)
    expect(asked?.detail).toBe('Question round 1')
  })

  it('orders a stage by rank, then age', async () => {
    const { setRank } = await import('../../src/core/record/store')
    const first = await view()
    const [a, b] = ids(first.stages.intake)
    await setRank(s.e.db.payload, b ?? 0, -5)
    const reordered = await view()
    expect(ids(reordered.stages.intake).slice(0, 2)).toEqual([b, a])
    await setRank(s.e.db.payload, b ?? 0, 0)
  })

  it('filters by Product and by Workspace', async () => {
    const other = await board(s.e.db.payload, { workspace: s.e.db.otherWorkspace, now: now() })
    expect(Object.values(other.stages).flat().map((c) => c.recordId)).toEqual([s.names.foreign])
    const none = await board(s.e.db.payload, { workspace: s.e.db.workspace, product: s.e.db.product + 99, now: now() })
    expect(Object.values(none.stages).flat()).toEqual([])
    const mine = await board(s.e.db.payload, { workspace: s.e.db.workspace, product: s.e.db.product, now: now() })
    expect(Object.values(mine.stages).flat()).toHaveLength(14)
  })

  it('shows held mirror issues of outside authors under intake and drops done tickets after seven days', async () => {
    await s.item(9001, { author: 'stranger', trusted: false })
    const { held } = await view()
    expect(held.map((h) => [h.number, h.reason])).toEqual([[9001, 'outside-author']])
    const week = new Date(Date.now() + 8 * 86_400_000)
    const later = await board(s.e.db.payload, { workspace: s.e.db.workspace, now: week })
    expect(later.stages.done).toEqual([])
  })

  it('makes a constant number of queries', async () => {
    const execute = vi.spyOn(s.e.db.payload.db.drizzle, 'execute')
    await view()
    expect(execute.mock.calls.length).toBeLessThanOrEqual(3)
    execute.mockRestore()
  })
})

describe('stageStats counts', () => {
  it('counts the four states per stage and lists live runs', async () => {
    const { stages, totals } = await stageStats(s.e.db.payload, { workspace: s.e.db.workspace, now: now() })
    const by = Object.fromEntries(stages.map((st) => [st.stage, st]))
    expect(by.intake?.counts).toEqual({ owner: 0, agents: 2, stuck: 2, others: 1 })
    expect(by.brief?.counts).toEqual({ owner: 1, agents: 1, stuck: 0, others: 0 })
    expect(by.build?.counts).toEqual({ owner: 0, agents: 1, stuck: 1, others: 0 })
    expect(by.verify?.counts).toEqual({ owner: 0, agents: 1, stuck: 0, others: 1 })
    expect(by.ship?.counts).toEqual({ owner: 1, agents: 0, stuck: 0, others: 0 })
    expect(by.done?.total).toBe(2)
    expect(by.intake?.runs.map((r) => r.leasedBy).sort()).toEqual([null, 'worker-1'])
    expect(by.verify?.runs).toHaveLength(1)
    expect(totals.shippedLast7Days).toBe(1)
  })

  it('is isolated by Workspace', async () => {
    const { stages } = await stageStats(s.e.db.payload, { workspace: s.e.db.otherWorkspace, now: now() })
    expect(stages.map((st) => st.counts.agents)).toEqual([1, 0, 0, 0, 0, 0])
    expect(stages.flatMap((st) => st.runs)).toHaveLength(1)
  })

  it('makes a constant number of queries', async () => {
    const execute = vi.spyOn(s.e.db.payload.db.drizzle, 'execute')
    await stageStats(s.e.db.payload, { workspace: s.e.db.workspace, now: now() })
    expect(execute.mock.calls.length).toBeLessThanOrEqual(4)
    execute.mockRestore()
  })
})
