import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readRecord } from '../../src/core/record/store'
import { board, laneCursor, laneMore, relationCounts } from '../../src/core/views/board'
import { openViews } from './views-harness'
import type { Engine } from './harness'
import { begin, mirrorSource } from './scenario'

let e: Engine
const filter = () => ({ workspace: e.db.workspace, now: new Date() })
const ids: Record<'head' | 'tail' | 'partOne' | 'partTwo' | 'parent', number> = {
  head: 0,
  tail: 0,
  partOne: 0,
  partTwo: 0,
  parent: 0,
}

const recordIds = async (limit: number, scope: Parameters<typeof board>[3]) =>
  (await board(e.db.payload, filter(), limit, scope)).stages.intake.map((card) => card.recordId)

beforeAll(async () => {
  e = await openViews('core_board_scope')
  const { payload, workspace, product } = e.db
  const mirror = await mirrorSource(e)
  const item: Record<string, number> = {}
  for (const name of Object.keys(ids) as (keyof typeof ids)[]) {
    const record = await begin(e)
    ids[name] = record
    const { number } = (await readRecord(payload, record)).record.source
    item[name] = await mirror.item(number, { title: name })
  }
  const edges = [
    [item['head'], item['tail'], 'blocks'],
    [item['partOne'], item['parent'], 'part-of'],
    [item['partTwo'], item['parent'], 'part-of'],
  ] as const
  for (const [from, to, type] of edges) {
    await payload.db.drizzle.execute(sql`
      INSERT INTO "ticket_relations" ("workspace_id", "from_item_id", "to_item_id", "type")
      VALUES (${workspace}, ${from}, ${to}, ${type})`)
  }
  await payload.db.drizzle.execute(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
      "waiting_on", "data", "updated_at", "created_at")
    SELECT ${workspace}, ${product}, 'github', 'scope/app', 5000 + n, 'intake', 'agents',
      jsonb_build_object('type', 'bug', 'source', jsonb_build_object('forge', 'github', 'repo', 'scope/app',
        'number', 5000 + n, 'reporter', 'bulk', 'external', false, 'backlog', false)),
      now(), now() - n * interval '1 minute'
    FROM generate_series(1, 70) n`)
}, 240_000)
afterAll(async () => {
  await e?.drop()
})

describe('a scoped Factory board', () => {
  it('keeps only the tickets that block others and counts the lane in SQL', async () => {
    const scoped = await board(e.db.payload, filter(), 30, { relation: 'blocking' })
    expect(scoped.stages.intake.map((card) => card.recordId)).toEqual([ids.head])
    expect(scoped.totals?.intake).toBe(1)
    expect(await relationCounts(e.db.payload, filter())).toEqual({ blocking: 1, blocked: 1 })
  })

  it('splits the board by parent without loading the whole lane', async () => {
    const withParent = await board(e.db.payload, filter(), undefined, { parent: 'with' })
    expect(withParent.stages.intake.map((card) => card.recordId).sort()).toEqual([ids.partOne, ids.partTwo].sort())
    const rest = await board(e.db.payload, filter(), 30, { parent: 'without' })
    const everyone = (await board(e.db.payload, filter())).stages.intake
    expect(rest.stages.intake).toHaveLength(30)
    expect(rest.totals?.intake).toBe(everyone.length - 2)
    expect(rest.stages.intake.map((card) => card.recordId)).not.toContain(ids.partOne)
  })

  it('continues a scoped lane after its cursor in the lane order', async () => {
    const full = await recordIds(1000, { parent: 'without' })
    const first = (await board(e.db.payload, filter(), 30, { parent: 'without' })).stages.intake
    const next = await laneMore(e.db.payload, filter(), {
      stage: 'intake',
      after: laneCursor(first.at(-1)!),
      limit: 30,
      scope: { parent: 'without' },
    })
    expect(next.map((card) => card.recordId)).toEqual(full.slice(30, 60))
  })

  it('returns no card, and no SQL error, when the scope matches nothing', async () => {
    const none = await board(e.db.payload, filter(), 30, { relation: 'blocking', parent: 'with' })
    expect(none.stages.intake).toEqual([])
    expect(none.totals?.intake).toBe(0)
  })
})
