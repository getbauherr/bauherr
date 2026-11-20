import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { sendDeferred } from '../../src/core/deferred'
import { DISCLOSURE } from '../../src/core/forge/disclosure'
import { createWriter } from '../../src/core/forge/writer'
import { remindReporters } from '../../src/core/intake/timing'
import { readEvents } from '../../src/core/record/store'
import { board } from '../../src/core/views/board'
import { firstLook } from '../../src/core/views/first-look'
import { ticket } from '../../src/core/views/ticket'
import { flowHarness } from './modules-harness'

const f = flowHarness('core_deferred_flow')
const DAY = 86_400_000

const NEEDS_INFO = {
  outcome: 'needs-info',
  type: 'bug',
  reason: 'two facts are missing',
  questions: [{ text: 'Which browser?', suggested: 'Firefox' }],
}
const DUPLICATE = { outcome: 'duplicate', type: 'bug', reason: 'same as the other one', duplicateOf: 2 }

const POSTED = Date.parse('2025-12-01T00:00:00Z')

const switchOn = async () => {
  await f.product(sql`"state" = 'active'`)
  await sendDeferred(f.subDeps(), f.h.ids.product)
}

const countOf = async (id: number, type: string) =>
  (await readEvents(f.h.payload(), id)).filter((e) => e.type === type).length

const at = (ms: number) => void (f.clock.now = new Date(ms))

const remind = () =>
  remindReporters(
    f.deps(),
    createWriter(f.h.payload(), { backend: async () => f.fake(), now: () => f.clock.now }),
  )

const stamp = (id: number, asked: string, posted: string) =>
  f.h.rows(sql`UPDATE "events" SET "created_at" = CASE WHEN "type" = 'intake.asked' THEN ${asked}::timestamptz
      ELSE ${posted}::timestamptz END
    WHERE "record_id" = ${id}
      AND ("type" = 'intake.asked' OR ("type" = 'forge.write.done' AND "data"->>'kind' = 'question'))`)

const status = async (id: number) => {
  const cards = Object.values(
    (await board(f.h.payload(), { workspace: f.h.ids.workspace, now: f.clock.now })).stages,
  ).flat()
  return cards.find((card) => card.recordId === id)?.status
}

const pageStatus = async (id: number) =>
  (await ticket(f.h.payload(), { workspace: f.h.ids.workspace, recordId: id })).status

describe('an observing Product with a question for the reporter', () => {
  it('keeps the question as a draft, starts no clock and says so on the board', async () => {
    const s = await f.start('observing')
    await f.work(s.id, 'builder', NEEDS_INFO)
    expect(await f.comments(s.repo)).toEqual([])
    const [draft] = (await readEvents(f.h.payload(), s.id)).filter((e) => e.type === 'forge.write.deferred')
    expect(draft?.data).toMatchObject({ kind: 'question' })
    expect(JSON.stringify(draft?.data)).toContain('Questions, round 1')
    expect(await countOf(s.id, 'forge.write.started')).toBe(0)
    for (const days of [7, 21, 400]) {
      at(Date.now() + days * DAY)
      await remind()
      expect(await countOf(s.id, 'reporter.reminded')).toBe(0)
      expect(await countOf(s.id, 'reporter.silent')).toBe(0)
    }
    expect(await status(s.id)).toBe('question-drafted')
    expect(await pageStatus(s.id)).toBe('question-drafted')
    const look = await firstLook(f.h.payload(), {
      workspace: f.h.ids.workspace,
      product: f.h.ids.product,
      now: f.clock.now,
    })
    expect(look.issues.needingInformation).toBe(1)
  })
})

describe('switching the Product on', () => {
  it('posts the drafted question once, with the disclosure, and the reporter clock starts then', async () => {
    const s = await f.start('observing')
    await f.work(s.id, 'builder', NEEDS_INFO)
    await switchOn()
    const comments = await f.comments(s.repo)
    expect(comments).toHaveLength(1)
    expect(comments[0]?.body.startsWith(DISCLOSURE)).toBe(true)
    expect(comments[0]?.body).toContain('Questions, round 1')
    expect(await status(s.id)).toBe('reporter-asked')
    expect(await pageStatus(s.id)).toBe('reporter-asked')

    await stamp(s.id, '2025-11-01T00:00:00Z', '2025-12-01T00:00:00Z')
    at(POSTED + 6.9 * DAY)
    await remind()
    expect(await countOf(s.id, 'reporter.reminded')).toBe(0)
    at(POSTED + 7 * DAY)
    await remind()
    expect(await countOf(s.id, 'reporter.reminded')).toBe(1)
    expect(await f.comments(s.repo)).toHaveLength(2)
    at(POSTED + 21 * DAY)
    await remind()
    expect(await countOf(s.id, 'reporter.silent')).toBe(1)
  })

  it('recognises a reply to the posted question', async () => {
    const s = await f.start('observing')
    await f.work(s.id, 'builder', NEEDS_INFO)
    await switchOn()
    await f.backdateAsked(s.id)
    f.fake().actingAs = 'jo'
    await f.fake().tickets(s.repo).comment('1', 'Firefox')
    f.fake().actingAs = 'factory'
    await s.sync()
    expect(await f.types(s.id)).toContain('reporter.replied')
  })

  it('posts the reason and closes a duplicate when autoClose is on', async () => {
    const s = await f.start('observing')
    await f.work(s.id, 'builder', DUPLICATE)
    expect(await f.comments(s.repo)).toEqual([])
    expect((await f.fake().tickets(s.repo).get('1')).state).toBe('open')
    await switchOn()
    const comments = await f.comments(s.repo)
    expect(comments.map((c) => c.body)).toEqual([`${DISCLOSURE}\n\nClosing as duplicate of #2: same as the other one`])
    expect((await f.fake().tickets(s.repo).get('1')).state).toBe('closed')
  })

  it('posts only the reason when autoClose is off', async () => {
    await f.product(sql`"auto_close" = false`)
    const s = await f.start('observing')
    await f.work(s.id, 'builder', DUPLICATE)
    await switchOn()
    expect(await f.comments(s.repo)).toHaveLength(1)
    expect((await f.fake().tickets(s.repo).get('1')).state).toBe('open')
  })

  it('sends nothing twice when called again or switched off and on', async () => {
    const s = await f.start('observing')
    await f.work(s.id, 'builder', DUPLICATE)
    await switchOn()
    await sendDeferred(f.subDeps(), f.h.ids.product)
    await f.product(sql`"state" = 'observing'`)
    await switchOn()
    expect(await f.comments(s.repo)).toHaveLength(1)
    const done = (await readEvents(f.h.payload(), s.id)).filter((e) => e.type === 'forge.write.done')
    expect(done.map((e) => e.data.kind).sort()).toEqual(['close', 'question'])
  })
})
