import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { createRecord } from '../src/core/record/store'
import { coreDbOn } from '../tests/core/db'
import { source } from '../tests/core/fixtures'
import { mirrorSource } from '../tests/core/scenario'

const o = { overrideAccess: true } as const
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const patch = { patchId: 'p1', headSha: 'abc', pr: 5 }

type Event = [minute: number, type: string, data?: unknown]
type Run = { stage: string; role: string; created: number; started: number; finished: number; cost?: number }
type Shape = { number: number; title: string; doneDaysAgo: number; events: Event[]; runs: Run[] }

const shipped = (accepted: number): Event[] => [
  [60, 'build.submitted', { runId: '1', ...patch }],
  [70, 'verify.passed', { runId: '2', patchId: 'p1', headSha: 'abc' }],
  [71, 'ship.merged', { sha: 'm1' }],
  [accepted, 'result.accepted'],
]

const SHAPES: Shape[] = [
  {
    number: 1,
    title: 'Add target-year check',
    doneDaysAgo: 2,
    events: [
      [6, 'intake.accepted'],
      [20, 'brief.submitted', { runId: '1' }],
      [50, 'brief.approved', { by: 'owner' }],
      ...shipped(200).map(([minute, ...rest]): Event => [minute + 100, ...rest]),
    ],
    runs: [
      { stage: 'intake', role: 'builder', created: 0, started: 2, finished: 6, cost: 0.4 },
      { stage: 'brief', role: 'builder', created: 6, started: 8, finished: 20, cost: 1.3 },
      { stage: 'build', role: 'builder', created: 50, started: 55, finished: 155, cost: 2.5 },
      { stage: 'verify', role: 'reviewer', created: 160, started: 161, finished: 171, cost: 1.1 },
      { stage: 'verify', role: 'verifier', created: 172, started: 173, finished: 183, cost: 1.5 },
    ],
  },
  {
    number: 2,
    title: 'Fix date format',
    doneDaysAgo: 5,
    events: [
      [10, 'intake.accepted'],
      [10, 'brief.approved', { by: 'rule' }],
      ...shipped(90),
      [100, 'result.sent-back', { note: 'The year is still wrong.' }],
      [160, 'build.submitted', { runId: '3', patchId: 'p2', headSha: 'def', pr: 5 }],
      [170, 'verify.passed', { runId: '4', patchId: 'p2', headSha: 'def' }],
      [171, 'ship.merged', { sha: 'm2' }],
      [240, 'result.accepted'],
    ],
    runs: [
      { stage: 'build', role: 'builder', created: 10, started: 12, finished: 60, cost: 2.2 },
      { stage: 'build', role: 'builder', created: 101, started: 103, finished: 160, cost: 1.8 },
      { stage: 'verify', role: 'verifier', created: 161, started: 162, finished: 170, cost: 0.6 },
    ],
  },
  {
    number: 3,
    title: 'Import skips empty rows',
    doneDaysAgo: 12,
    events: [[5, 'intake.accepted'], [5, 'brief.approved', { by: 'rule' }], ...shipped(120)],
    runs: [{ stage: 'build', role: 'builder', created: 5, started: 7, finished: 60 }],
  },
]

const fingerprint = (shape: Shape, run: Run): string => `insights-${shape.number}-${run.created}`

const seedTicket = async (payload: Payload, ids: { workspace: number; product: number }, shape: Shape) => {
  const origin = { ...source, repo: 'insights/app', number: shape.number }
  const record = await createRecord(payload, { ...ids, source: origin, type: 'bug' })
  const last = shape.events.at(-1)?.[0] ?? 0
  const base = Date.now() - shape.doneDaysAgo * DAY - last * MINUTE
  const at = (minute: number) => new Date(base + minute * MINUTE).toISOString()
  const run = (query: ReturnType<typeof sql>) => payload.db.drizzle.execute(query)
  await run(sql`UPDATE "records" SET "created_at" = ${at(0)}, "stage" = 'done', "waiting_on" = 'nobody'
    WHERE "id" = ${record.id}`)
  for (const [minute, type, data] of shape.events) {
    await run(sql`
      INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "created_at", "updated_at")
      VALUES (${ids.workspace}, ${record.id}, ${type}, 'factory', ${JSON.stringify(data ?? {})}::jsonb,
        ${at(minute)}, now())`)
  }
  for (const r of shape.runs) {
    await run(sql`
      INSERT INTO "stage_runs" ("workspace_id", "record_id", "stage", "role", "status", "fingerprint", "attempt",
        "steps", "cost_usd", "cost_source", "started_at", "finished_at", "created_at", "updated_at")
      VALUES (${ids.workspace}, ${record.id}, ${r.stage}, ${r.role}, 'submitted', ${fingerprint(shape, r)}, 0,
        '[]'::jsonb, ${r.cost ?? null}, ${r.cost === undefined ? null : 'gateway'}, ${at(r.started)},
        ${at(r.finished)}, ${at(r.created)}, now())`)
  }
  return record.id
}

export const seedInsights = async (payload: Payload): Promise<void> => {
  const where = { slug: { equals: 'insights' } }
  if ((await payload.find({ collection: 'workspaces', where, limit: 1, ...o })).docs.length) return
  const data = { name: 'Insights', slug: 'insights' }
  const workspace = Number((await payload.create({ collection: 'workspaces', data, ...o })).id)
  const app = { name: 'Insights App', slug: 'insights-app', workspace }
  const product = Number((await payload.create({ collection: 'products', data: app, ...o })).id)
  const ids = { workspace, otherWorkspace: workspace, product }
  const { item } = await mirrorSource({ db: coreDbOn(payload, ids, async () => {}) }, 'insights/app')
  const records: number[] = []
  for (const shape of SHAPES) {
    records.push(await seedTicket(payload, ids, shape))
    await item(shape.number, { title: shape.title })
  }
  await payload.db.drizzle.execute(sql`
    INSERT INTO "statements" ("workspace_id", "product_id", "record_id", "kind", "scope", "text", "source_kind",
      "source_text", "learn_run", "came_back", "seen_at", "updated_at", "created_at")
    SELECT "workspace_id", "product_id", "id", 'learned', 'product', 'Check the year of every date.', 'finding',
      'The year is wrong. Evidence: open the report', 1, ${JSON.stringify([{ record: records[1], run: 1 }])}::jsonb,
      now(), now(), now()
    FROM "records" WHERE "id" = ${records[0]}`)
}
