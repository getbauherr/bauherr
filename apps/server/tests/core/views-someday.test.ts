import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    await run(sql`UPDATE "products" SET "intake_excluded_labels" = '["wontfix"]'::jsonb`)
    await s.item(905, { labels: ['wontfix'] })
    expect(await find()).toMatchObject([{ count: 1 }])
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
})
