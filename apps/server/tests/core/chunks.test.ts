import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { board, laneCursor, laneMore } from '../../src/core/views/board'
import { INBOX_GROUPS, inboxMore, loadInbox } from '../../src/core/views/inbox'
import { requestCounts, requestPage, type RequestCursor } from '../../src/core/views/request-list'
import { loadRows } from '../../src/core/views/rows'
import { stageStats } from '../../src/core/views/stats'
import { openViews } from './views-harness'
import type { Engine } from './harness'

let e: Engine
const filter = () => ({ workspace: e.db.workspace, now: new Date() })
const viewer = { forgeLogins: ['bulk'], sentRecordIds: [] }

beforeAll(async () => {
  e = await openViews('core_chunks')
  const { workspace, product } = e.db
  const db = e.db.payload.db.drizzle
  await db.execute(sql`
    INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
      "waiting_on", "card", "data", "updated_at", "created_at")
    SELECT ${workspace}, ${product}, 'github', 'chunks/app', 1000 + n, 'intake',
      CASE n % 5 WHEN 0 THEN 'owner' WHEN 1 THEN 'nobody' ELSE 'agents' END,
      CASE WHEN n % 5 = 0 THEN '{"card":"brief","reason":"approval","options":[],"seq":0}'::jsonb END,
      jsonb_build_object('type', 'bug', 'source', jsonb_build_object('forge', 'github', 'repo', 'chunks/app',
        'number', 1000 + n, 'reporter', 'bulk', 'external', false, 'backlog', false)),
      now() - (n % 40) * interval '1 minute', now() - n * interval '1 minute'
    FROM generate_series(1, 260) n`)
  await db.execute(sql`
    INSERT INTO "events" ("workspace_id", "record_id", "type", "actor", "data", "created_at", "updated_at")
    SELECT "workspace_id", "id", CASE WHEN "id" % 2 = 0 THEN 'result.accepted' ELSE 'ticket.closed' END, 'owner',
      '{}'::jsonb, "updated_at", "updated_at"
    FROM "records" WHERE "workspace_id" = ${workspace} AND "waiting_on" = 'nobody'`)
}, 240_000)
afterAll(async () => {
  await e?.drop()
})

describe('Inbox chunks', () => {
  it('keep the exact totals, the same order and no row twice across Show more', async () => {
    const full = await loadInbox(e.db.payload, filter(), 10_000)
    const first = await loadInbox(e.db.payload, filter(), 20)
    expect(first.you.cards.map((c) => c.recordId)).toEqual(full.you.cards.map((c) => c.recordId))
    for (const group of INBOX_GROUPS) {
      expect(first[group].total, group).toBe(full[group].total)
      expect(first[group].total).toBe(full[group].cards.length)
    }
    expect(first.done.cards).toHaveLength(20)
    expect(full.done.total).toBeGreaterThan(40)
    const seen = first.done.cards.map((c) => c.recordId)
    let cursor = first.done.cursor
    while (cursor) {
      const more = await inboxMore(e.db.payload, filter(), { group: 'done', after: cursor, limit: 20 })
      seen.push(...more.cards.map((c) => c.recordId))
      cursor = more.cards.length === 20 ? more.cursor : null
    }
    expect(seen).toEqual(full.done.cards.map((c) => c.recordId))
  })
})

describe('Factory lane chunks', () => {
  it('continue a lane after its cursor in the lane order and match the stage total', async () => {
    const full = (await board(e.db.payload, filter())).stages.intake.map((c) => c.recordId)
    const first = (await board(e.db.payload, filter(), 30)).stages.intake
    expect(first.map((c) => c.recordId)).toEqual(full.slice(0, 30))
    const { stages } = await stageStats(e.db.payload, filter())
    expect(stages.find((s) => s.stage === 'intake')?.total).toBe(full.length)
    const last = first.at(-1)!
    const next = await laneMore(e.db.payload, filter(), { stage: 'intake', after: laneCursor(last), limit: 30 })
    expect(next.map((c) => c.recordId)).toEqual(full.slice(30, 60))
  })
})

describe('Requests list chunks', () => {
  it('page a bucket by last change and count every bucket in SQL', async () => {
    const f = { ...filter(), history: 'all' as const }
    const all = await loadRows(e.db.payload, f)
    const live = all
      .filter((r) => r.ended === 'accepted')
      .sort((a, b) => +b.changedAt - +a.changedAt || b.recordId - a.recordId)
      .map((r) => r.recordId)
    const counts = await requestCounts(e.db.payload, f, viewer)
    expect(counts.live).toBe(live.length)
    expect(counts.mine).toBe(all.filter((r) => r.reporter === 'bulk').length)
    const seen: number[] = []
    let after: RequestCursor | null = null
    do {
      const page = await requestPage(e.db.payload, f, { viewer, show: 'live', after, limit: 25 })
      seen.push(...page.rows.map((r) => r.recordId))
      after = page.cursor
    } while (after)
    expect(seen).toEqual(live)
  })
})
