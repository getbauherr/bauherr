import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { coreDbOn } from '../tests/core/db'
import { mirrorSource } from '../tests/core/scenario'

const o = { overrideAccess: true } as const
const PATH_SETS = { security: ['src/auth/**', 'src/billing/**'], ui: ['src/app/**'] }
const YEAR_AGO = new Date(Date.now() - 400 * 86_400_000).toISOString()

type Shape = { slug: string; name: string; imported: boolean; error?: string }
type Item = Awaited<ReturnType<typeof mirrorSource>>['item']

const SHAPES: Shape[] = [
  { slug: 'connect-look', name: 'Look App', imported: true },
  { slug: 'connect-switch', name: 'Switch App', imported: true },
  { slug: 'connect-copy', name: 'Copy App', imported: true },
  { slug: 'connect-importing', name: 'Importing App', imported: false },
  {
    slug: 'connect-broken',
    name: 'Broken App',
    imported: false,
    error: 'GitHub answered 401: Bad credentials',
  },
]

const workspaceId = async (payload: Payload): Promise<number> => {
  const found = await payload.find({ collection: 'workspaces', where: { slug: { equals: 'connect' } }, limit: 1, ...o })
  const data = { name: 'Connect', slug: 'connect' }
  const doc = found.docs[0] ?? (await payload.create({ collection: 'workspaces', data, ...o }))
  return Number(doc.id)
}

const fillMirror = async (item: Item, full: boolean) => {
  await item(1, { title: 'Export fails for large files' })
  await item(2, { title: 'Report shows the wrong year', assignees: ['jo'] })
  await item(3, { title: 'Old request', updated: YEAR_AGO })
  if (!full) return
  await item(4, { title: 'Please add a dark theme', author: 'stranger', trusted: false })
  await item(5, { title: 'Closed long ago', state: 'closed' })
  await item(101, { kind: 'pr', title: 'Fix the export', closes: [1], head: 'abc1010' })
  await item(102, { kind: 'pr', title: 'Bump a dependency' })
  await item(103, { kind: 'pr', title: 'Refactor the importer' })
}

const settle = async (payload: Payload, source: number, shape: Shape) => {
  const now = sql`now()`
  const facts = shape.imported
  await payload.db.drizzle.execute(sql`
    UPDATE "ticket_sources" SET "imported_at" = ${shape.imported ? now : null}, "last_polled_at" = now(),
      "last_error" = ${shape.error ?? null}, "default_branch" = ${facts ? 'main' : null},
      "branch_protected" = ${facts ? 'yes' : null},
      "required_check_names" = ${facts ? JSON.stringify(['test', 'lint']) : null}::jsonb,
      "has_agents_file" = ${facts ? false : null}, "issue_form_count" = ${facts ? 0 : null},
      "facts_at" = ${facts ? now : null}
    WHERE "id" = ${source}`)
}

const seedProduct = async (payload: Payload, workspace: number, shape: Shape) => {
  const { slug, name } = shape
  const product = { name, slug, workspace, pathSets: PATH_SETS, riskAreas: ['security'], backlogBriefLimit: 4 }
  const made = await payload.create({ collection: 'products', data: product, ...o })
  await payload.db.drizzle.execute(sql`UPDATE "products" SET "connected_at" = now() WHERE "id" = ${Number(made.id)}`)
  const ids = { workspace, otherWorkspace: workspace, product: Number(made.id) }
  const repo = `connect/${slug}`
  const { source, item } = await mirrorSource({ db: coreDbOn(payload, ids, async () => {}) }, repo)
  const repository = { fullName: repo, product: ids.product, workspace }
  await payload.create({ collection: 'repositories', data: repository, ...o })
  await fillMirror(item, shape.imported)
  await settle(payload, source, shape)
}

export const seedConnect = async (payload: Payload): Promise<void> => {
  const workspace = await workspaceId(payload)
  for (const shape of SHAPES) {
    const where = { slug: { equals: shape.slug } }
    const known = await payload.find({ collection: 'products', where, limit: 1, ...o })
    if (!known.docs.length) await seedProduct(payload, workspace, shape)
  }
}
