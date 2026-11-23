import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { coreDbOn } from '../tests/core/db'
import { mirrorSource } from '../tests/core/scenario'

const o = { overrideAccess: true } as const
const LABEL = 'bauherr:someday'

type Shape = { slug: string; name: string; repo: string; gitlab: boolean }

const SHAPES: Shape[] = [
  { slug: 'someday-hub', name: 'Someday Hub', repo: 'someday/hub', gitlab: false },
  { slug: 'someday-lab', name: 'Someday Lab', repo: 'someday/lab', gitlab: true },
]

const workspaceId = async (payload: Payload): Promise<number> => {
  const found = await payload.find({ collection: 'workspaces', where: { slug: { equals: 'someday' } }, limit: 1, ...o })
  const data = { name: 'Someday', slug: 'someday' }
  const doc = found.docs[0] ?? (await payload.create({ collection: 'workspaces', data, ...o }))
  return Number(doc.id)
}

const seedProduct = async (payload: Payload, workspace: number, shape: Shape) => {
  const made = await payload.create({
    collection: 'products',
    data: { name: shape.name, slug: shape.slug, workspace },
    ...o,
  })
  const ids = { workspace, otherWorkspace: workspace, product: Number(made.id) }
  const { source, item } = await mirrorSource({ db: coreDbOn(payload, ids, async () => {}) }, shape.repo)
  await item(1, { title: 'Parked idea', labels: [LABEL] })
  await item(2, { title: 'Another parked idea', labels: [LABEL, 'idea'] })
  await item(3, { title: 'Closed idea', labels: [LABEL], state: 'closed' })
  if (!shape.gitlab) return
  const config = JSON.stringify({ baseUrl: 'https://git.example.com' })
  await payload.db.drizzle.execute(sql`
    UPDATE "connections" SET "kind" = 'gitlab', "config" = ${config}::jsonb
    WHERE "id" = (SELECT "connection_id" FROM "ticket_sources" WHERE "id" = ${source})`)
}

export const seedSomeday = async (payload: Payload): Promise<void> => {
  const workspace = await workspaceId(payload)
  for (const shape of SHAPES) {
    const where = { slug: { equals: shape.slug } }
    const known = await payload.find({ collection: 'products', where, limit: 1, ...o })
    if (!known.docs.length) await seedProduct(payload, workspace, shape)
  }
}
