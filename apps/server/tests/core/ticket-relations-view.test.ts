import { sql } from '@payloadcms/db-postgres'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadTicketRelations, searchTickets } from '../../src/core/views/ticket-relations'
import { relationsHarness } from './relations-harness'

const { h, setup } = relationsHarness('ticket_relations_view')

beforeEach(async () => {
  await h.rows(sql`DELETE FROM "events"`)
  await h.rows(sql`DELETE FROM "records"`)
  await h.rows(sql`UPDATE "products" SET "state" = 'active'`)
})

describe('the relations of a ticket', () => {
  it('are grouped by what it is part of, waits for, blocks and relates to, each with a stage', async () => {
    const s = await setup(['subject', 'parent', 'blocker', 'dependent', 'peer', 'unrelated'])
    const edge = (from: number, to: number, type: string) => s.writer.addRelation(s.record.id, {
      from: s.item(from),
      to: s.item(to),
      type,
    })
    await edge(1, 2, 'part-of')
    await edge(3, 1, 'blocks')
    await edge(1, 4, 'blocks')
    await edge(5, 1, 'relates-to')
    const view = await loadTicketRelations(h.payload(), h.ids.workspace, s.record.id)
    const names = (group: 'part-of' | 'blocked-by' | 'blocks' | 'relates-to') =>
      view?.groups[group].map((t) => `#${t.number} ${t.title} ${t.stage}`)
    expect(names('part-of')).toEqual(['#2 parent Not on the board'])
    expect(names('blocked-by')).toEqual(['#3 blocker Not on the board'])
    expect(names('blocks')).toEqual(['#4 dependent Not on the board'])
    expect(names('relates-to')).toEqual(['#5 peer Not on the board'])
    const found = (query: string) => searchTickets(h.payload(), h.ids.workspace, s.record.id, query)
    expect((await found('')).map((c) => c.number)).toEqual([6, 5, 4, 3, 2])
    expect((await found('#4')).map((c) => c.number)).toEqual([4])
    expect((await found('UNREL')).map((c) => c.number)).toEqual([6])
  })

  it('list an exact number first and still find old tickets by title among many', async () => {
    const s = await setup(['subject', 'Box ancient'])
    const [template] = await h.items(s.repo)
    for (let number = 3; number <= 230; number++) {
      await h.payload().create({
        collection: 'mirror_items',
        data: {
          workspace: h.ids.workspace,
          product: h.ids.product,
          source: Number(template.source_id),
          repo: s.repo,
          state: 'open',
          forgeCreatedAt: new Date().toISOString(),
          number,
          kind: 'issue',
          title: `t${number}`,
        },
        overrideAccess: true,
      })
    }
    for (const typed of ['2', '#2']) {
      const found = await searchTickets(h.payload(), h.ids.workspace, s.record.id, typed)
      expect(found).toHaveLength(20)
      expect(found.slice(0, 2).map((c) => c.number)).toEqual([2, 230])
    }
    const byTitle = await searchTickets(h.payload(), h.ids.workspace, s.record.id, 'Box ancient')
    expect(byTitle.map((c) => c.number)).toEqual([2])
  })

  it('show a closed blocker as Closed and not open', async () => {
    const s = await setup()
    await s.writer.addRelation(s.record.id, { from: s.item(2), to: s.item(1), type: 'blocks' })
    await h.rows(sql`UPDATE "mirror_items" SET "state" = 'closed' WHERE "id" = ${s.item(2)}`)
    const view = await loadTicketRelations(h.payload(), h.ids.workspace, s.record.id)
    expect(view?.groups['blocked-by'].map((t) => [t.stage, t.open])).toEqual([['Closed', false]])
  })

  it('are null for a ticket of another Workspace', async () => {
    const s = await setup()
    expect(await loadTicketRelations(h.payload(), h.ids.workspace + 1000, s.record.id)).toBeNull()
  })
})
