import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { readRecord } from '../src/core/record/store'
import { coreDbOn } from '../tests/core/db'
import { engineOn } from '../tests/core/harness'
import { begin, mirrorSource, toBrief } from '../tests/core/scenario'

const o = { overrideAccess: true } as const

const workspaceId = async (payload: Payload): Promise<number> => {
  const where = { slug: { equals: 'relations' } }
  const found = await payload.find({ collection: 'workspaces', where, limit: 1, ...o })
  const data = { name: 'Relations', slug: 'relations' }
  return Number((found.docs[0] ?? (await payload.create({ collection: 'workspaces', data, ...o }))).id)
}

export const seedBoardRelations = async (payload: Payload): Promise<void> => {
  const workspace = await workspaceId(payload)
  const inWorkspace = { workspace: { equals: workspace } }
  const known = await payload.find({ collection: 'records', where: inWorkspace, limit: 1, ...o })
  if (known.docs.length) return
  const data = { name: 'Relations App', slug: 'relations-app', workspace, state: 'active' }
  const product = Number((await payload.create({ collection: 'products', data, ...o })).id)
  const ids = { workspace, otherWorkspace: workspace, product }
  const engine = engineOn(coreDbOn(payload, ids, async () => {}), undefined, new Date())
  const mirror = await mirrorSource(engine)
  const numberOf = async (id: number) => (await readRecord(payload, id)).record.source.number
  const ticket = async (id: number, title: string) => mirror.item(await numberOf(id), { title })
  const closedPart = (n: number, title: string) => mirror.item(5000 + n, { title, state: 'closed' })
  const head = await ticket(await toBrief(engine, false), 'Chain head')
  const middle = await ticket(await begin(engine), 'Chain middle')
  const tail = await ticket(await begin(engine), 'Chain tail')
  const parent = await ticket(await begin(engine), 'Parent epic')
  const parts = [
    await closedPart(1, 'Part finished one'),
    await closedPart(2, 'Part finished two'),
    await ticket(await begin(engine), 'Part open one'),
    await ticket(await begin(engine), 'Part open two'),
  ]
  const edges = [
    [head, middle, 'blocks'],
    [middle, tail, 'blocks'],
    ...parts.map((part) => [part, parent, 'part-of']),
  ] as const
  for (const [from, to, type] of edges) {
    await payload.db.drizzle.execute(sql`
      INSERT INTO "ticket_relations" ("workspace_id", "from_item_id", "to_item_id", "type")
      VALUES (${workspace}, ${from}, ${to}, ${type})`)
  }
}
