import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appendEvent, setProjection } from '../../src/core/record/store'
import { board } from '../../src/core/views/board'
import { waitingOnOwner } from '../../src/core/views/owner'
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
const crowd = async () => {
  for (let i = 0; i < 200; i++) await s.e.db.fresh()
}
const view = async () => board(s.e.db.payload, { workspace: s.e.db.workspace, now: now() })

describe('board', () => {
  it('puts every ticket in its stage with status, state and who has the turn', async () => {
    const { stages, parked } = await view()
    const n = s.names
    const rows = (cards: typeof stages.intake) => cards.map((c) => [c.recordId, c.status, c.state])
    expect(rows(stages.intake)).toEqual(
      expect.arrayContaining([
        [n.intakeQueued, 'queued', 'agents'],
        [n.intakeWorking, 'triaging', 'agents'],
        [n.reporterAsked, 'reporter-asked', 'others'],
        [n.failedRuns, 'failed-runs', 'stuck'],
        [n.reporterSilent, 'reporter-silent', 'stuck'],
      ]),
    )
    expect(stages.intake).toHaveLength(5)
    expect(rows(stages.brief)).toEqual(
      expect.arrayContaining([
        [n.briefQueued, 'queued', 'agents'],
        [n.briefCard, 'brief-needs-approval', 'owner'],
      ]),
    )
    expect(stages.brief).toHaveLength(2)
    expect(rows(stages.build)).toEqual(
      expect.arrayContaining([[n.building, 'queued', 'agents'], [n.verifyRounds, 'verify-rounds', 'stuck']]),
    )
    expect(rows(stages.verify)).toEqual(
      expect.arrayContaining([
        [n.waitingChecks, 'waiting-for-checks', 'others'],
        [n.reviewing, 'reviewing', 'agents'],
        [n.verifying, 'queued', 'agents'],
      ]),
    )
    expect(rows(stages.ship)).toEqual([[n.resultCard, 'result-ready', 'owner']])
    expect(rows(stages.done)).toEqual(
      expect.arrayContaining([[n.accepted, 'accepted', 'none'], [n.closed, 'closed', 'none']]),
    )
    expect(ids(parked)).toEqual([n.parked])
    expect(parked[0]).toMatchObject({ status: 'parked', state: 'none', stage: 'brief', parkedReason: 'limit reached' })
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
    expect(Object.values(mine.stages).flat()).toHaveLength(15)
  })

  it('shows held mirror issues of outside authors under intake and drops done tickets after seven days', async () => {
    await s.item(9001, { author: 'stranger', trusted: false })
    const { held } = await view()
    expect(held.map((h) => [h.number, h.reason])).toEqual([[9001, 'outside-author']])
    const week = new Date(Date.now() + 8 * 86_400_000)
    const later = await board(s.e.db.payload, { workspace: s.e.db.workspace, now: week })
    expect(later.stages.done).toEqual([])
  })
})

describe('waitingOnOwner', () => {
  it('counts the tickets that wait on the owner or are stuck, as the board shows them', async () => {
    const { stages } = await view()
    const shown = Object.values(stages).flat().filter((c) => c.state === 'owner' || c.state === 'stuck')
    expect(shown.length).toBeGreaterThan(3)
    expect(await waitingOnOwner(s.e.db.payload, s.e.db.workspace)).toBe(shown.length)
    expect(await waitingOnOwner(s.e.db.payload, s.e.db.otherWorkspace)).toBe(0)
  })
})

describe('stageStats counts', () => {
  it('counts the four states per stage and lists live runs', async () => {
    const { stages, totals } = await stageStats(s.e.db.payload, { workspace: s.e.db.workspace, now: now() })
    const by = Object.fromEntries(stages.map((st) => [st.stage, st]))
    expect(by.intake?.counts).toEqual({ owner: 0, agents: 2, stuck: 2, others: 1 })
    expect(by.brief?.counts).toEqual({ owner: 1, agents: 1, stuck: 0, others: 0 })
    expect(by.build?.counts).toEqual({ owner: 0, agents: 1, stuck: 1, others: 0 })
    expect(by.verify?.counts).toEqual({ owner: 0, agents: 2, stuck: 0, others: 1 })
    expect(by.ship?.counts).toEqual({ owner: 1, agents: 0, stuck: 0, others: 0 })
    expect(by.done?.total).toBe(2)
    expect(by.intake?.runs.map((r) => r.leasedBy).sort()).toEqual([null, 'worker-1'])
    expect(by.verify?.runs.map((r) => r.role).sort()).toEqual(['reviewer', 'verifier'])
    expect(totals.shippedLast7Days).toBe(1)
  })

  it('is isolated by Workspace', async () => {
    const { stages } = await stageStats(s.e.db.payload, { workspace: s.e.db.otherWorkspace, now: now() })
    expect(stages.map((st) => st.counts.agents)).toEqual([1, 0, 0, 0, 0, 0])
    expect(stages.flatMap((st) => st.runs)).toHaveLength(1)
  })
})

describe('query counts with 200 more open tickets', () => {
  beforeAll(crowd, 120_000)

  const count = async (work: () => Promise<unknown>): Promise<number> => {
    const execute = vi.spyOn(s.e.db.payload.db.drizzle, 'execute')
    await work()
    const calls = execute.mock.calls.length
    execute.mockRestore()
    return calls
  }

  it('makes three queries for the board', async () => {
    expect(await count(view)).toBeLessThanOrEqual(3)
  })

  it('makes four queries for the stage statistics', async () => {
    const stats = () => stageStats(s.e.db.payload, { workspace: s.e.db.workspace, now: now() })
    expect(await count(stats)).toBeLessThanOrEqual(4)
  })
})

describe('card facts', () => {
  const card = async (id: number) => Object.values((await view()).stages).flat().find((c) => c.recordId === id)

  it('says why a closed ticket closed', async () => {
    expect((await card(s.names.closed))?.closedAs).toBe('discarded')
    const id = await s.e.db.fresh()
    await appendEvent(s.e.db.payload, id, { type: 'intake.closed', data: { reason: 'duplicate' }, actor: 'agent' })
    await setProjection(s.e.db.payload, id, { stage: 'intake', waitingOn: 'nobody' })
    expect(await card(id)).toMatchObject({ status: 'closed', closedAs: 'duplicate' })
    expect((await card(s.names.accepted))?.closedAs).toBeNull()
  })

  it('counts the criteria met from the record', async () => {
    expect((await card(s.names.verifying))?.criteria?.total).toBe(3)
    await s.e.db.payload.db.drizzle.execute(sql`UPDATE "records" SET "data" = jsonb_set("data", '{criteria,0,status}',
      '"met"') WHERE "id" = ${s.names.verifying}`)
    expect((await card(s.names.verifying))?.criteria).toEqual({ met: 1, total: 3 })
    expect((await card(s.names.intakeQueued))?.criteria).toBeNull()
  })
})
