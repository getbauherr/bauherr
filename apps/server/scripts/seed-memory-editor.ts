import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

const o = { overrideAccess: true } as const

const FACTORY = '## All stages\n- Say what changed in the handoff.\n'

const BASE = ['## All stages', '- Use pnpm for every script.']
const VERIFY = ['## Verify', '- Show every new screen in the proof.']
const VERIFY_375 = ['## Verify', '- Show every new screen at 375 px in the proof.']

const PRODUCT_VERSIONS = [
  {
    author: 'seed',
    reason: 'edited',
    at: '2026-11-03T09:00:00Z',
    body: [...BASE, '', ...VERIFY].join('\n') + '\n',
  },
  {
    author: 'seed',
    reason: 'retro',
    at: '2026-11-12T09:00:00Z',
    body: [...BASE, '- Name things as the screen names them.', '', ...VERIFY].join('\n') + '\n',
  },
  {
    author: 'seed',
    reason: 'edited',
    at: '2026-11-18T09:00:00Z',
    body: [...BASE, '- Name things as the screen names them.', '', ...VERIFY_375].join('\n') + '\n',
  },
]

const insert = (
  workspace: number | null,
  product: number | null,
  scope: string,
  v: (typeof PRODUCT_VERSIONS)[number],
) =>
  sql`INSERT INTO "memory_document_versions"
    ("workspace_id", "product_id", "scope", "body", "author", "reason", "created_at", "updated_at")
    VALUES (${workspace}, ${product}, ${scope}, ${v.body}, ${v.author}, ${v.reason}, ${v.at}, ${v.at})`

export const seedMemoryEditor = async (
  p: Payload,
  ensureUser: (address: string, tenant: number) => Promise<unknown>,
) => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'memedit' } }, limit: 1, ...o })
  if (known.docs.length) return
  const workspace = Number(
    (await p.create({ collection: 'workspaces', data: { name: 'Memedit', slug: 'memedit' }, ...o })).id,
  )
  const data = { name: 'Memedit App', slug: 'memedit-app', workspace }
  const product = Number((await p.create({ collection: 'products', data, ...o })).id)
  await ensureUser('memedit-bauherr@example.com', workspace)
  const factory = await p.db.drizzle.execute(
    sql`SELECT 1 FROM "memory_document_versions" WHERE "scope" = 'factory' LIMIT 1`,
  )
  if (!factory.rows.length) {
    await p.db.drizzle.execute(
      insert(null, null, 'factory', { author: 'seed', reason: 'edited', at: '2026-11-01T09:00:00Z', body: FACTORY }),
    )
  }
  for (const version of PRODUCT_VERSIONS) await p.db.drizzle.execute(insert(workspace, product, 'product', version))
}
