import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { createRecord } from '../src/core/record/store'

const o = { overrideAccess: true } as const
const REPO = 'check/app'

export const WANTS_CHECK = [
  'A forge answer that says "not in your plan" is an empty answer.',
  'A migration needs a timestamp prefix no other migration has.',
  'Never open an issue on a real forge.',
]

export const seedCheck = async (p: Payload): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'check' } }, limit: 1, ...o })
  if (known.docs.length) return
  const workspaceData = { name: 'Check', slug: 'check' }
  const workspace = Number((await p.create({ collection: 'workspaces', data: workspaceData, ...o })).id)
  const secret = 'e2e-dummy-secret'
  const connectionData = { name: 'GitHub Check', kind: 'github', config: {}, secret, workspace } as const
  const connection = Number((await p.create({ collection: 'connections', data: connectionData, ...o })).id)
  const productData = { name: 'Check App', slug: 'check-app', workspace, state: 'active' }
  const product = Number((await p.create({ collection: 'products', data: productData, ...o })).id)
  const sourceData = { repo: REPO, product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  await p.create({ collection: 'ticket_sources', data: sourceData, ...o })
  const marks = []
  for (const number of [101, 102, 103]) {
    const source = { forge: 'github', repo: REPO, number, reporter: 'jo', external: false, backlog: false } as const
    marks.push({ record: (await createRecord(p, { workspace, product, source, type: 'bug' })).id, run: 1 })
  }
  for (const text of WANTS_CHECK) {
    await p.db.drizzle.execute(sql`
      INSERT INTO "statements" ("workspace_id", "product_id", "kind", "scope", "applies", "text", "came_back",
        "updated_at", "created_at")
      VALUES (${workspace}, ${product}, 'written', 'product', 'fit', ${text}, ${JSON.stringify(marks)}::jsonb,
        now(), now())`)
  }
}
