import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { appendEvent, setProjection } from '../../src/core/record/store'
import { stageStats } from '../../src/core/views/stats'
import type { Engine } from './harness'
import { openViews } from './views-harness'

let e: Engine
const HOUR = 3_600_000
const T = new Date()

const hoursAgo = (h: number) => new Date(T.getTime() - h * HOUR).toISOString()
const at = (h: number, event: AppEvent): [number, AppEvent] => [h, event]
const build = (n: number): AppEvent => ({
  type: 'build.submitted',
  data: { runId: 'r', patchId: `p${n}`, headSha: 'h', pr: n },
})
const passed: AppEvent = { type: 'verify.passed', data: { runId: 'r', patchId: 'p', headSha: 'h' } }
const accepted: AppEvent = { type: 'intake.accepted', data: {} }
const approved: AppEvent = { type: 'brief.approved', data: { by: 'owner' } }

const history = async (workspace: number, created: number, events: [number, AppEvent][], waiting = 'nobody') => {
  const id = await e.db.fresh(workspace)
  const db = e.db.payload.db.drizzle
  await db.execute(sql`UPDATE "records" SET "created_at" = ${hoursAgo(created)}::timestamptz WHERE "id" = ${id}`)
  for (const [h, event] of events) {
    const stored = await appendEvent(e.db.payload, id, { ...event, actor: 'factory' })
    await db.execute(sql`UPDATE "events" SET "created_at" = ${hoursAgo(h)}::timestamptz WHERE "id" = ${stored.id}`)
  }
  await setProjection(e.db.payload, id, { stage: 'done', waitingOn: waiting === 'nobody' ? 'nobody' : 'owner' })
  return id
}

beforeAll(async () => {
  e = await openViews('core_views_stats')
  await history(e.db.workspace, 100, [
    at(98, accepted), at(95, approved), at(90, build(1)), at(86, passed), at(80, { type: 'result.accepted', data: {} }),
  ])
  await history(e.db.workspace, 50, [
    at(46, accepted), at(40, approved), at(30, build(1)),
    at(28, { type: 'verify.changes', data: { runId: 'r', patchId: 'p' } }),
    at(25, { type: 'question.asked', data: { reason: 'failed-runs', options: ['retry', 'discard'] } }),
    at(20, build(2)), at(18, passed),
    at(10, { type: 'result.sent-back', data: { note: 'again' } }),
    at(8, build(3)), at(6, passed), at(5, { type: 'result.accepted', data: {} }),
  ])
  await history(e.db.workspace, 10, [at(3, { type: 'ticket.closed', data: { reason: 'discarded' } })])
  await history(e.db.otherWorkspace, 4, [at(3, accepted)])
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

const stats = (workspace: number, product?: number) => stageStats(e.db.payload, { workspace, product, now: T })
const medians = async (workspace: number) => (await stats(workspace)).stages.map((s) => s.medianSeconds)

describe('stageStats from events', () => {
  it('takes the median of every stay in a stage, counting each re-entry', async () => {
    expect(await medians(e.db.workspace)).toEqual([4 * 3600, 4.5 * 3600, 6.5 * 3600, 2 * 3600, 6 * 3600, null])
  })

  it('computes the header totals', async () => {
    const { totals } = await stats(e.db.workspace)
    expect(totals).toEqual({
      shippedLast7Days: 2,
      finishedLast7Days: 3,
      medianSecondsToAccept: 32.5 * 3600,
      firstPassAcceptRate: 0.5,
      exceptionRate: 1 / 3,
      sentBackFromVerifyLast7Days: 1,
      sentBackFromShipLast7Days: 1,
    })
  })

  it('counts tickets sent back from Verify and from Ship over the last 7 days only', async () => {
    const later = new Date(T.getTime() + 6 * 24 * HOUR)
    const { totals } = await stageStats(e.db.payload, { workspace: e.db.workspace, now: later })
    expect(totals).toMatchObject({ sentBackFromVerifyLast7Days: 0, sentBackFromShipLast7Days: 1 })
    expect((await stats(e.db.otherWorkspace)).totals).toMatchObject({
      sentBackFromVerifyLast7Days: 0,
      sentBackFromShipLast7Days: 0,
    })
  })

  it('leaves stays and tickets of another Workspace out', async () => {
    expect((await medians(e.db.otherWorkspace)).slice(0, 2)).toEqual([3600, null])
    const { totals } = await stats(e.db.otherWorkspace)
    expect(totals).toMatchObject({ shippedLast7Days: 0, medianSecondsToAccept: null, firstPassAcceptRate: null })
  })

  it('leaves stays that ended more than 30 days ago out and filters by Product', async () => {
    const later = new Date(T.getTime() + 40 * 24 * HOUR)
    const far = await stageStats(e.db.payload, { workspace: e.db.workspace, now: later })
    expect(far.stages.map((s) => s.medianSeconds)).toEqual([null, null, null, null, null, null])
    const other = await stats(e.db.workspace, e.db.product + 99)
    expect(other.stages.map((s) => s.medianSeconds)).toEqual([null, null, null, null, null, null])
  })
})
