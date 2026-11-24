import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRecord } from '../../src/core/record/store'
import { costOfComingBack } from '../../src/core/views/cost-view'
import { insightsPage } from '../../src/core/views/insights-page'
import { ticket } from '../../src/core/views/ticket'
import { openCoreDb, type CoreDb } from './db'
import { source } from './fixtures'

let db: CoreDb
let second: number
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const NOW = new Date()

beforeAll(async () => {
  db = await openCoreDb('core_insights_view')
  const data = { name: 'second', slug: 'second', workspace: db.workspace }
  second = Number((await db.payload.create({ collection: 'products', data, overrideAccess: true })).id)
}, 120_000)
afterAll(async () => {
  await db?.drop()
})

type E = [minute: number, type: string, data?: unknown]
type R = { stage: string; role: string; created: number; started: number; finished: number; cost?: number }
let number = 100

const exec = (query: ReturnType<typeof sql>) => db.payload.db.drizzle.execute(query)

const insertEvent = (ids: { workspace: number; record: number }, at: string, [, type, data]: E) =>
  exec(sql`
    INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "created_at", "updated_at")
    VALUES (${ids.workspace}, ${ids.record}, ${type}, 'factory', ${JSON.stringify(data ?? {})}::jsonb, ${at}, now())`)

const insertRun = (ids: { workspace: number; record: number }, at: (minute: number) => string, r: R) =>
  exec(sql`
    INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role", "status", "fingerprint", "attempt",
      "steps", "cost_usd", "cost_source", "started_at", "finished_at", "created_at", "updated_at")
    VALUES (${ids.workspace}, ${ids.record}, ${r.stage}, ${r.role}, 'submitted', ${`fp-${number}-${r.created}`}, 0,
      '[]'::jsonb, ${r.cost ?? null}, ${r.cost === undefined ? null : 'gateway'}, ${at(r.started)}, ${at(r.finished)},
      ${at(r.created)}, now())`)

const seed = async (input: {
  doneDaysAgo: number
  events: E[]
  runs?: R[]
  workspace?: number
  product?: number
}): Promise<number> => {
  const workspace = input.workspace ?? db.workspace
  const product = input.product ?? db.product
  const origin = { ...source, number: number++ }
  const record = await createRecord(db.payload, { workspace, product, source: origin, type: 'bug' })
  const last = input.events.at(-1)?.[0] ?? 0
  const base = NOW.getTime() - input.doneDaysAgo * DAY - last * MINUTE
  const at = (minute: number) => new Date(base + minute * MINUTE).toISOString()
  const ids = { workspace, record: record.id }
  await exec(sql`UPDATE "records" SET "created_at" = ${at(0)} WHERE "id" = ${record.id}`)
  for (const event of input.events) await insertEvent(ids, at(event[0]), event)
  for (const run of input.runs ?? []) await insertRun(ids, at, run)
  return record.id
}

const patch = { patchId: 'p1', headSha: 'abc', pr: 5 }
const HAPPY: E[] = [
  [6, 'intake.accepted'],
  [20, 'brief.submitted', { runId: '2' }],
  [50, 'brief.approved', { by: 'owner' }],
  [115, 'build.submitted', { runId: '3', ...patch }],
  [126, 'review.submitted', { runId: '4', patchId: 'p1', headSha: 'abc', findings: 0 }],
  [136, 'checks.finished', { patchId: 'p1', passed: true }],
  [147, 'verify.passed', { runId: '5', patchId: 'p1', headSha: 'abc' }],
  [148, 'ship.merged', { sha: 'm1' }],
  [200, 'result.accepted'],
]
const HAPPY_RUNS: R[] = [
  { stage: 'intake', role: 'builder', created: 0, started: 2, finished: 6, cost: 0.5 },
  { stage: 'brief', role: 'builder', created: 6, started: 8, finished: 20, cost: 1 },
  { stage: 'build', role: 'builder', created: 50, started: 55, finished: 115, cost: 2 },
  { stage: 'verify', role: 'reviewer', created: 115, started: 116, finished: 126 },
  { stage: 'verify', role: 'verifier', created: 136, started: 137, finished: 147, cost: 0.25 },
  { stage: 'done', role: 'reviewer', created: 201, started: 202, finished: 210, cost: 0.125 },
]
const SIMPLE: E[] = [
  [10, 'intake.accepted'],
  [10, 'brief.approved', { by: 'rule' }],
  [60, 'build.submitted', { runId: '1', ...patch }],
  [70, 'verify.passed', { runId: '2', patchId: 'p1', headSha: 'abc' }],
  [71, 'ship.merged', { sha: 'm' }],
  [100, 'result.accepted'],
]
const view = (days: 7 | 30 | 90, extra: { product?: number; workspace?: number } = {}) =>
  insightsPage(db.payload, { workspace: extra.workspace ?? db.workspace, days, now: NOW, ...extra })

describe('the Insights view of a Workspace', () => {
  let happy: number
  beforeAll(async () => {
    happy = await seed({ doneDaysAgo: 2, events: HAPPY, runs: HAPPY_RUNS })
    await seed({ doneDaysAgo: 10, events: SIMPLE, product: second })
    await seed({ doneDaysAgo: 3, events: [[0, 'intake.accepted'], [30, 'ticket.closed', { reason: 'archived' }]] })
    await seed({ doneDaysAgo: 1, events: SIMPLE, workspace: db.otherWorkspace })
    await seed({ doneDaysAgo: 100, events: SIMPLE })
  })

  it('counts tickets by their done date within the range and leaves out archived and foreign ones', async () => {
    const week = await view(7)
    expect(week.time.done).toBe(1)
    expect(week.time.medianSeconds).toBe(200 * 60)
    const month = await view(30)
    expect(month.time.done).toBe(2)
    expect(month.time.medianSeconds).toBe(150 * 60)
    expect((await view(90)).time.done).toBe(2)
    expect((await view(7, { workspace: db.otherWorkspace })).time.done).toBe(1)
  })

  it('filters by Product and ignores a Product of another Workspace', async () => {
    expect((await view(30, { product: second })).time.done).toBe(1)
    expect((await view(30, { product: db.product })).time.done).toBe(1)
    const foreign = await view(30, { product: 999_999 })
    expect(foreign.product).toBeNull()
    expect(foreign.time.done).toBe(2)
  })

  it('gives the median per stage with the split and names the largest waiting share', async () => {
    const week = await view(7)
    const brief = week.time.stages.find((row) => row.stage === 'brief')
    expect(brief?.seconds).toBe(44 * 60)
    expect(brief?.split).toEqual({ agent: 12 * 60, you: 30 * 60, ci: 0, queued: 2 * 60 })
    expect(week.time.sentence).toBe('Waiting on you is the largest share in Ship.')
  })

  it('counts the claimed runs and only the measured ones into the cost, never as zero', async () => {
    const week = await view(7)
    const row = (key: string) => week.cost.rows.find((entry) => entry.key === key)
    expect(row('build')).toMatchObject({ runs: 1, measured: 1, costUsd: 2 })
    expect(row('review')).toMatchObject({ runs: 1, measured: 0, costUsd: 0, perTicket: null })
    expect(row('learn')).toMatchObject({ runs: 1, measured: 1, costUsd: 0.125 })
    expect(week.cost.total).toMatchObject({ runs: 6, measured: 5, costUsd: 3.875, medianPerTicket: 3.875 })
    expect(week.cost.tickets).toEqual({ all: 1, measured: 1 })
    expect(week.cost.top[0]).toMatchObject({ recordId: happy, number: 100, costUsd: 3.875, measured: 5, runs: 6 })
  })

  it('shows cost outside runs only from the days in range, or nothing when it was never measured', async () => {
    expect((await view(7)).outside).toBeNull()
    const today = NOW.toISOString().slice(0, 10)
    const old = new Date(NOW.getTime() - 20 * DAY).toISOString().slice(0, 10)
    const value = JSON.stringify({ days: { [today]: 1.5, [old]: 4 }, measuredAt: NOW.toISOString() })
    const key = `cost-outside:${db.workspace}`
    const insert = sql`INSERT INTO "instance_state" ("key", "value") VALUES (${key}, ${value}::jsonb)`
    await db.payload.db.drizzle.execute(insert)
    expect((await view(7)).outside).toBe(1.5)
    expect((await view(30)).outside).toBe(5.5)
  })

  it('has the time and cost of one ticket for its page', async () => {
    const shown = await ticket(db.payload, { workspace: db.workspace, recordId: happy })
    expect(shown.timing.time.seconds).toBe(200 * 60)
    expect(shown.timing.time.you).toBe(82 * 60)
    expect(shown.timing.cost).toEqual({ costUsd: 3.875, measured: 5, runs: 6 })
  })
})

describe('the cost of coming back', () => {
  it('sums the Build and Verify runs after the correction on the tickets a memory came back on', async () => {
    const events: E[] = [
      [0, 'intake.accepted'],
      [10, 'brief.approved', { by: 'rule' }],
      [60, 'build.submitted', { runId: '1', ...patch }],
      [70, 'verify.passed', { runId: '2', patchId: 'p1', headSha: 'abc' }],
      [71, 'ship.merged', { sha: 'm' }],
      [80, 'result.sent-back', { note: 'wrong' }],
      [200, 'result.accepted'],
    ]
    const runs: R[] = [
      { stage: 'build', role: 'builder', created: 10, started: 11, finished: 60, cost: 9 },
      { stage: 'build', role: 'builder', created: 81, started: 82, finished: 112, cost: 1 },
      { stage: 'build', role: 'builder', created: 120, started: 121, finished: 151, cost: 0.5 },
      { stage: 'verify', role: 'verifier', created: 160, started: 161, finished: 171, cost: 0.25 },
      { stage: 'verify', role: 'reviewer', created: 175, started: 176, finished: 186 },
    ]
    const record = await seed({ doneDaysAgo: 1, events, runs })
    const found = await db.payload.db.drizzle.execute(sql`
      INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "scope", "text", "came_back",
        "updated_at", "created_at")
      SELECT "workspace_id", "product_id", "id", 'learned', 'product', 'Check the last row.',
        ${JSON.stringify([{ record, run: 1 }])}::jsonb, now(), now() FROM "records" WHERE "id" = ${record}
      RETURNING "id"`)
    const id = Number(found.rows[0]?.id)
    const back = await costOfComingBack(db.payload, { workspace: db.workspace, id })
    const seconds = (30 + 30 + 10 + 10) * 60
    expect(back).toEqual({ tickets: 1, rounds: 2, seconds, costUsd: 1.75, measured: 3, runs: 4 })
    expect(await costOfComingBack(db.payload, { workspace: db.otherWorkspace, id })).toBeNull()
  })

  it('has nothing for a memory that never came back', async () => {
    const found = await db.payload.db.drizzle.execute(sql`
      INSERT INTO "statements" ("workspace_id", "product_id", "kind", "scope", "text", "updated_at", "created_at")
      VALUES (${db.workspace}, ${db.product}, 'guidance', 'product', 'Never came back.', now(), now()) RETURNING "id"`)
    expect(await costOfComingBack(db.payload, { workspace: db.workspace, id: Number(found.rows[0]?.id) })).toBeNull()
  })
})
