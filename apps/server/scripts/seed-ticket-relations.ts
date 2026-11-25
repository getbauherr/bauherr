import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { createRecord } from '../src/core/record/store'
import { RELATION_REPO, RELATION_TITLES } from '../src/lib/fake-forge'

const o = { overrideAccess: true } as const

const EDGES = [
  [1, 2, 'part-of'],
  [3, 1, 'blocks'],
  [1, 4, 'blocks'],
  [1, 5, 'relates-to'],
  [8, 7, 'blocks'],
] as const

export const seedTicketRelations = async (p: Payload): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'relbox' } }, limit: 1, ...o })
  if (known.docs.length) return
  const workspaceData = { name: 'Relbox', slug: 'relbox' }
  const workspace = Number((await p.create({ collection: 'workspaces', data: workspaceData, ...o })).id)
  const secret = 'e2e-dummy-secret'
  const connectionData = { name: 'GitHub Relbox', kind: 'github', config: {}, secret, workspace } as const
  const connection = Number((await p.create({ collection: 'connections', data: connectionData, ...o })).id)
  const productData = { name: 'Relbox App', slug: 'relbox-app', workspace, state: 'active' }
  const product = Number((await p.create({ collection: 'products', data: productData, ...o })).id)
  const sourceData = { repo: RELATION_REPO, product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  const source = Number((await p.create({ collection: 'ticket_sources', data: sourceData, ...o })).id)
  const items = new Map<number, number>()
  for (const [index, title] of RELATION_TITLES.entries()) {
    const number = index + 1
    const forgeCreatedAt = new Date().toISOString()
    const base = { workspace, source, product, repo: RELATION_REPO, state: 'open', forgeCreatedAt }
    const item = await p.create({ collection: 'mirror_items', data: { ...base, number, kind: 'issue', title }, ...o })
    items.set(number, Number(item.id))
    const input = {
      workspace,
      product,
      source: { forge: 'github', repo: RELATION_REPO, number, reporter: 'jo', external: false, backlog: false },
      type: 'change',
    } as const
    await createRecord(p, input)
  }
  for (const [from, to, type] of EDGES) {
    await p.db.drizzle.execute(sql`
      INSERT INTO "ticket_relations" ("workspace_id", "from_item_id", "to_item_id", "type")
      VALUES (${workspace}, ${items.get(from)}, ${items.get(to)}, ${type})`)
  }
}
