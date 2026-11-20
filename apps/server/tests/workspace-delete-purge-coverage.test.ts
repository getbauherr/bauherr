import { sql } from '@payloadcms/db-postgres'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { anyRow, queryRows } from './helpers/query-rows'
import { bootPurgeDb, type PurgeDb } from './helpers/workspace-purge'

const foreignKey = z.object({ child: z.string(), parent: z.string(), del: z.string() })
type ForeignKey = z.infer<typeof foreignKey>

let db: PurgeDb

beforeAll(async () => {
  db = await bootPurgeDb('workspace_purge_coverage')
})

afterAll(async () => {
  await db?.payload?.destroy()
  await db?.testDb?.drop(db.payload)
})

const reachableFrom = (root: string, fks: ForeignKey[]): Set<string> => {
  const reach = new Set([root])
  for (let grew = true; grew;) {
    grew = false
    for (const f of fks) {
      if (!reach.has(f.parent) || reach.has(f.child)) continue
      reach.add(f.child)
      grew = true
    }
  }
  return reach
}

const needsOrder = (f: ForeignKey, order: string[]): boolean =>
  f.del !== 'c' &&
  f.child !== f.parent &&
  f.child !== 'workspaces' &&
  order.includes(f.child) &&
  order.includes(f.parent)

it(
  'every table that reaches a Workspace, Ticket or Product is covered by the purge, ' + 'children before parents',
  async () => {
    const { payload, del } = db
    const fks = await queryRows(
      payload,
      foreignKey,
      sql`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent, c.confdeltype AS del FROM
      pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
    )
    const reach = reachableFrom('workspaces', fks)
    const order = del.PURGE_ORDER.map((p) => p.table)
    const uncovered = [...reach].filter((t) => !order.includes(t) && !del.PURGE_CASCADED.includes(t))
    expect(
      uncovered,
      'tables pointing at a Workspace without purge coverage: add them to PURGE_ORDER in lib/workspace-delete.ts',
    ).toEqual([])
    expect(order.filter((t) => !reach.has(t))).toEqual([])
    const loose = await queryRows(
      payload,
      anyRow,
      sql`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name ILIKE
      '%workspace%' AND table_name NOT IN (SELECT unnest(${`{${[...reach].join(',')}}`}::text[]))`,
    )
    expect(loose, 'a column naming a Workspace without a foreign key: purge it by hand').toEqual([])
    for (const t of del.PURGE_CASCADED)
      expect(
        fks.filter((f) => f.child === t && reach.has(f.parent)).every((f) => f.del === 'c'),
        `${t} must cascade`,
      ).toBe(true)
    for (const f of fks.filter((k) => needsOrder(k, order)))
      expect(order.indexOf(f.child), `${f.child} must be deleted before ${f.parent}`).toBeLessThan(
        order.indexOf(f.parent),
      )
  },
)
