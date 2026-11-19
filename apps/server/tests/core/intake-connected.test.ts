import { FakeBackend } from '@bauherr/adapters'
import { sql } from '@payloadcms/db-postgres'
import { describe, expect, it } from 'vitest'
import { markConnected } from '../../src/core/intake/connected'
import { enterIssues } from '../../src/core/intake/enter'
import { intakeHarness } from './intake-harness'
import { readerOf } from './mirror-harness'

const { h, deps, product } = intakeHarness('core_intake_connected')

const connectedAt = async () =>
  (await h.rows(sql`SELECT "connected_at" AS at FROM "products" WHERE "id" = ${h.ids.product}`))[0]?.at

describe('connecting a Product', () => {
  it('sets connectedAt on the first repository and keeps it on later ones', async () => {
    expect(await connectedAt()).toBeNull()
    const first = new Date('2026-11-01T10:00:00Z')
    await markConnected(h.payload(), h.ids.product, first)
    expect(new Date(String(await connectedAt())).toISOString()).toBe(first.toISOString())
    await markConnected(h.payload(), h.ids.product, new Date('2026-11-10T10:00:00Z'))
    expect(new Date(String(await connectedAt())).toISOString()).toBe(first.toISOString())
  })

  it('marks issues older than connectedAt as backlog and newer ones not, through entering', async () => {
    const repo = h.fresh()
    const fake = new FakeBackend({ native: true, user: 'jo' })
    await fake.tickets(repo).create({ title: 'old' })
    await fake.tickets(repo).create({ title: 'old too' })
    await h.settle({ [repo]: readerOf(fake) })
    const items = await h.items(repo)
    const at = new Date(Date.parse(String(items[1]?.forge_created_at)) + 500)
    await markConnected(h.payload(), h.ids.product, at)
    await fake.tickets(repo).create({ title: 'new' })
    await fake.tickets(repo).create({ title: 'new too' })
    await h.sync({ [repo]: readerOf(fake) })
    await product(sql`"connected_at" = ${new Date(at.getTime()).toISOString()}::timestamptz`)
    await enterIssues(deps())
    const rows = await h.rows(sql`SELECT "source_number" AS n, "data" FROM "records" WHERE "source_repo" = ${repo}
      ORDER BY "source_number"`)
    expect(rows).toHaveLength(4)
    const flags = rows.map((r) => (r.data as { source: { backlog: boolean } }).source.backlog)
    expect(flags).toEqual([true, true, false, false])
  })
})
