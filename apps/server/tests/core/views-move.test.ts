import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { board } from '../../src/core/views/board'
import { moveInStage } from '../../src/app/(app)/lib/reorder'
import type { Engine } from './harness'
import { openViews } from './views-harness'

let e: Engine
let ids: number[]
let foreign: number

const order = async (workspace = e.db.workspace) =>
  (await board(e.db.payload, { workspace, now: new Date() })).stages.intake.map((card) => card.recordId)
const ranks = async (): Promise<Map<number, number>> =>
  new Map(
    (await board(e.db.payload, { workspace: e.db.workspace, now: new Date() })).stages.intake.map((card) => [
      card.recordId,
      card.rank,
    ]),
  )
const move = (recordId: number, afterId: number | null, workspace = e.db.workspace) =>
  moveInStage(e.db.payload, { workspace, recordId, afterId })

beforeAll(async () => {
  e = await openViews('core_views_move')
  ids = [await e.db.fresh(), await e.db.fresh(), await e.db.fresh(), await e.db.fresh()]
  foreign = await e.db.fresh(e.db.otherWorkspace)
}, 120_000)
afterAll(async () => {
  await e?.drop()
})

describe('moveInStage', () => {
  it('starts in age order', async () => {
    expect(await order()).toEqual(ids)
  })

  it('moves a card to the top and keeps it there', async () => {
    expect(await move(ids[3] ?? 0, null)).toBe(true)
    expect(await order()).toEqual([ids[3], ids[0], ids[1], ids[2]])
  })

  it('numbers the stage when cards share a rank, then moves with one write', async () => {
    expect(await move(ids[0] ?? 0, ids[1] ?? 0)).toBe(true)
    expect(await order()).toEqual([ids[3], ids[1], ids[0], ids[2]])
    const before = await ranks()
    expect(await move(ids[2] ?? 0, ids[3] ?? 0)).toBe(true)
    expect(await order()).toEqual([ids[3], ids[2], ids[1], ids[0]])
    const after = await ranks()
    expect([...after].filter(([id, rank]) => before.get(id) !== rank).map(([id]) => id)).toEqual([ids[2]])
  })

  it('moves to the bottom after the last card', async () => {
    const last = (await order()).at(-1) ?? 0
    const first = (await order())[0] ?? 0
    expect(await move(first, last)).toBe(true)
    expect((await order()).at(-1)).toBe(first)
  })

  it('refuses a card of another Workspace, a stranger as neighbour and a card in another stage', async () => {
    const before = await order()
    expect(await move(foreign, null)).toBe(false)
    expect(await move(ids[0] ?? 0, foreign)).toBe(false)
    expect(await move(ids[0] ?? 0, 999_999)).toBe(false)
    expect(await order()).toEqual(before)
    expect(await order(e.db.otherWorkspace)).toEqual([foreign])
  })
})
