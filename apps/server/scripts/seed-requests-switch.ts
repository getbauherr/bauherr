import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

const o = { overrideAccess: true } as const
const WORKSPACE = 'request-switch'
const PRODUCTS = [
  { slug: 'switch-alpha', name: 'Switch Alpha', repo: 'switch/alpha', number: 11, title: 'Alpha needs a dark footer' },
  { slug: 'switch-beta', name: 'Switch Beta', repo: 'switch/beta', number: 21, title: 'Beta loses the cart on reload' },
]

const idOf = (doc: { id: number | string }): number => Number(doc.id)

const workspaceOf = async (payload: Payload): Promise<number> => {
  const found = await payload.find({ collection: 'workspaces', where: { slug: { equals: WORKSPACE } }, ...o })
  const data = { name: 'Request switch', slug: WORKSPACE }
  return idOf(found.docs[0] ?? (await payload.create({ collection: 'workspaces', data, ...o })))
}

export const seedRequestsSwitch = async (payload: Payload): Promise<void> => {
  const workspace = await workspaceOf(payload)
  const known = await payload.find({ collection: 'products', where: { workspace: { equals: workspace } }, ...o })
  if (known.docs.length) return
  const connection = idOf(
    await payload.create({
      collection: 'connections',
      data: { name: 'GitHub Switch', kind: 'github', config: {}, secret: 'e2e-dummy-secret', workspace },
      ...o,
    }),
  )
  for (const entry of PRODUCTS) {
    const data = { name: entry.name, slug: entry.slug, workspace, state: 'active' as const }
    const product = idOf(await payload.create({ collection: 'products', data, ...o }))
    const cursor = '2026-10-30T09:00:00Z'
    const source = idOf(
      await payload.create({
        collection: 'ticket_sources',
        data: { repo: entry.repo, product, connection, cursor, workspace },
        ...o,
      }),
    )
    await payload.create({ collection: 'repositories', data: { fullName: entry.repo, product, workspace }, ...o })
    await payload.db.drizzle.execute(sql`
      INSERT INTO "mirror_items" ("workspace_id", "source_id", "product_id", "repo", "number", "kind", "title", "body",
        "state", "author", "author_trusted", "author_is_bot", "labels", "assignees", "url", "forge_created_at",
        "forge_updated_at", "head_sha", "closes", "draft", "synced_at", "updated_at", "created_at")
      VALUES (${workspace}, ${source}, ${product}, ${entry.repo}, ${entry.number}, 'issue', ${entry.title}, 'body',
        'open', 'jo', true, false, '[]'::jsonb, '[]'::jsonb, 'https://forge/x', now() - interval '1 day', now(), '',
        '[]'::jsonb, false, now(), now(), now())`)
    await payload.db.drizzle.execute(sql`
      INSERT INTO "records" ("workspace_id", "product_id", "source_forge", "source_repo", "source_number", "stage",
        "waiting_on", "data", "updated_at", "created_at")
      VALUES (${workspace}, ${product}, 'github', ${entry.repo}, ${entry.number}, 'build', 'agents',
        jsonb_build_object('type', 'bug', 'source', jsonb_build_object('forge', 'github', 'repo', ${entry.repo}::text,
          'number', ${entry.number}::int, 'reporter', 'jo', 'external', false, 'backlog', false)),
        now(), now() - interval '1 day')`)
  }
}
