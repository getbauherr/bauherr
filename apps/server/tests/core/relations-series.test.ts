import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from '@payloadcms/db-postgres'
import { relationsHarness } from './relations-harness'

const { h, setup, edges } = relationsHarness('relations_series')

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active'`)
})

const target = () => ({ workspace: h.ids.workspace, product: h.ids.product })

describe('filing a series of tickets', () => {
  it('creates their relations at once, in the store and on the forge (c4)', async () => {
    const s = await setup([])
    const [first, second, third] = await s.writer.openIssues(target(), [
      { title: 'Add the table', body: 'b', reference: 'series-1-a' },
      { title: 'Fill the table', body: 'b', reference: 'series-1-b', relations: [{ type: 'blocked-by', with: 0 }] },
      { title: 'Show the table', body: 'b', reference: 'series-1-c', relations: [{ type: 'part-of', with: 0 }] },
    ])
    expect((await s.tickets.get(String(second?.number))).blockedBy).toEqual([String(first?.number)])
    expect((await s.tickets.get(String(third?.number))).parent).toBe(String(first?.number))
    const rows = await edges()
    expect(rows.map((r) => r.type).sort()).toEqual(['blocks', 'part-of'])
  })

  it('files the same series again without a second relation or ticket', async () => {
    const s = await setup([])
    const series = [
      { title: 'One', body: 'b', reference: 'series-2-a' },
      { title: 'Two', body: 'b', reference: 'series-2-b', relations: [{ type: 'blocked-by' as const, with: 0 }] },
    ]
    await s.writer.openIssues(target(), series)
    await s.writer.openIssues(target(), series)
    expect(await edges()).toHaveLength(1)
  })
})
