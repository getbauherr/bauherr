import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pacing } from '../../src/core/intake/pacing'
import { readRecord } from '../../src/core/record/store'
import { holds } from '../../src/core/views/holds'
import { somedayCounts } from '../../src/core/views/someday'
import { stageStats } from '../../src/core/views/stats'
import { openViews, seed, type Seeded } from './views-harness'

let s: Seeded
const LABEL = 'bauherr:someday'
const run = (query: ReturnType<typeof sql>) => s.e.db.payload.db.drizzle.execute(query)
const find = (product?: number) => {
  const workspace = s.e.db.workspace
  return somedayCounts(s.e.db.payload, product === undefined ? { workspace } : { workspace, product })
}

beforeAll(async () => {
  s = await seed(await openViews('core_views_someday'))
}, 240_000)
afterAll(async () => {
  await s?.e.drop()
})

describe('somedayCounts', () => {
  it('counts open issues held back by an excluded label, per Product, and nothing else', async () => {
    expect(await find()).toEqual([])
    await s.item(901, { labels: [LABEL] })
    await s.item(902, { labels: [LABEL, 'bug'] })
    await s.item(903, { labels: ['bug'] })
    await s.item(904, { labels: [LABEL], state: 'closed' })
    expect(await find()).toMatchObject([{ product: s.e.db.product, forge: 'github', repo: 'acme/app', count: 2 }])
    expect(await find(s.e.db.product + 1000)).toEqual([])
    await run(sql`UPDATE "products" SET "intake_excluded_labels" = '["bauherr:someday", "wontfix"]'::jsonb`)
    await s.item(905, { labels: ['wontfix'] })
    expect(await find()).toMatchObject([{ count: 2 }])
    await run(sql`UPDATE "products" SET "intake_excluded_labels" = '["wontfix"]'::jsonb`)
    expect(await find()).toEqual([])
  })

  it('does not change the Holding up work strip or the stage counts', async () => {
    const filter = { workspace: s.e.db.workspace, now: new Date() }
    const read = async () => ({
      held: await holds(s.e.db.payload, filter),
      stages: (await stageStats(s.e.db.payload, filter)).stages,
    })
    const before = await read()
    await s.item(906, { labels: ['wontfix'] })
    expect(await read()).toEqual(before)
  })

  it('does not change the backlog Brief pacing count', async () => {
    const found = await run(sql`SELECT "id" FROM "records" WHERE "workspace_id" = ${s.e.db.workspace} LIMIT 1`)
    const stored = await readRecord(s.e.db.payload, Number(found.rows[0]?.id))
    const backlog = { ...stored, record: { ...stored.record, source: { ...stored.record.source, backlog: true } } }
    await run(sql`UPDATE "products" SET "backlog_brief_limit" = 0`)
    const verdict = () => pacing(s.e.db.payload)(backlog, 'brief')
    const before = await verdict()
    expect(before.ok).toBe(false)
    await s.item(907, { labels: [LABEL] })
    expect(await verdict()).toEqual(before)
  })
})
