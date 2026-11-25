import { sql } from '@payloadcms/db-postgres'
import { FakeBackend } from '@bauherr/adapters'
import { vi } from 'vitest'
import { createWriter } from '../../src/core/forge/writer'
import { createRecord } from '../../src/core/record/store'
import { mirrorHarness, readerOf } from './mirror-harness'

export const relationsHarness = (suite: string) => {
  const h = mirrorHarness(suite)

  const setup = async (titles: string[] = ['a', 'b', 'c']) => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    const tickets = fake.tickets(repo)
    for (const title of titles) await tickets.create({ title })
    await h.sync({ [repo]: readerOf(fake) })
    const rows = await h.items(repo)
    const item = (number: number) => Number(rows.find((r) => Number(r.number) === number)?.id)
    const record = await createRecord(h.payload(), {
      workspace: h.ids.workspace,
      product: h.ids.product,
      source: { forge: 'github', repo, number: 1, reporter: 'jo', external: false, backlog: false },
      type: 'bug',
    })
    const writer = createWriter(h.payload(), {
      backend: vi.fn(async () => fake),
      now: () => new Date('2026-11-19T12:00:00Z'),
    })
    const sync = () => h.sync({ [repo]: readerOf(fake) })
    return { repo, fake, tickets, item, record, writer, sync }
  }

  const edges = () =>
    h.rows(
      sql`SELECT "from_item_id" AS "from", "to_item_id" AS "to", "type" FROM "ticket_relations" ORDER BY "id"`,
    )

  return { h, setup, edges }
}
