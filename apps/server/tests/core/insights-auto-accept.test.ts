import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { appendEvent } from '../../src/core/record/store'
import { insightsPage } from '../../src/core/views/insights-page'
import { openCoreDb, type CoreDb } from './db'
import { ev } from './fixtures'

let db: CoreDb
beforeAll(async () => {
  db = await openCoreDb('core_insights_auto')
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

const AUTO = ev('result.accepted', {
  auto: {
    door: 'two-way',
    criteriaMet: 2,
    criteriaTotal: 2,
    checks: 'passed',
    sendBackPercent: 5,
    maxSendBackPercent: 10,
  },
})

const ticket = async (events: AppEvent[], actor: 'factory' | 'owner', actorId?: string) => {
  const id = await db.fresh()
  for (const event of events) {
    await appendEvent(db.payload, id, { ...event, actor, ...(actorId === undefined ? {} : { actorId }) })
  }
}

describe('Insights on auto-accepted Results', () => {
  it('counts what the factory accepted and how many of those were sent back later', async () => {
    await ticket([AUTO], 'factory', 'auto-accept')
    await ticket([AUTO, ev('result.sent-back')], 'factory', 'auto-accept')
    await ticket([ev('result.accepted')], 'owner', 'u7')
    await ticket([ev('result.accepted'), ev('result.sent-back')], 'owner', 'u7')
    const view = await insightsPage(db.payload, { workspace: db.workspace, days: 30, now: new Date() })
    expect(view.autoAccepted).toEqual({ total: 2, sentBack: 1 })
  })
})
