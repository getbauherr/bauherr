import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'

const o = { overrideAccess: true } as const
const REPO = 'ready/app'

export const seedReadiness = async (p: Payload): Promise<void> => {
  const known = await p.find({ collection: 'workspaces', where: { slug: { equals: 'readiness' } }, limit: 1, ...o })
  if (known.docs.length) return
  const workspaceData = { name: 'Readiness', slug: 'readiness' }
  const workspace = Number((await p.create({ collection: 'workspaces', data: workspaceData, ...o })).id)
  const secret = 'e2e-dummy-secret'
  const connectionData = { name: 'GitHub Readiness', kind: 'github', config: {}, secret, workspace } as const
  const connection = Number((await p.create({ collection: 'connections', data: connectionData, ...o })).id)
  const productData = { name: 'Readiness App', slug: 'readiness-app', workspace, state: 'active' }
  const product = Number((await p.create({ collection: 'products', data: productData, ...o })).id)
  const sourceData = { repo: REPO, product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  const source = Number((await p.create({ collection: 'ticket_sources', data: sourceData, ...o })).id)
  const suggestions = [{ name: 'auth', paths: ['src/auth/**'] }]
  await p.db.drizzle.execute(sql`
    UPDATE "ticket_sources" SET "default_branch" = 'main', "branch_protected" = 'unknown', "has_agents_file" = false,
      "issue_form_count" = 0, "facts_at" = now()
    WHERE "id" = ${source}`)
  await p.db.drizzle.execute(sql`
    INSERT INTO "instance_state" ("key", "value")
    VALUES (${`risk-suggestions:${source}`}, ${JSON.stringify(suggestions)}::jsonb)`)
  const pullData = {
    workspace,
    source,
    product,
    repo: REPO,
    number: 1,
    kind: 'pr',
    title: 'Add a button',
    state: 'open',
    forgeCreatedAt: new Date().toISOString(),
  }
  const pull = Number((await p.create({ collection: 'mirror_items', data: pullData, ...o })).id)
  for (const name of ['lint', 'test']) {
    const check = { workspace, item: pull, sha: 'abc', name, status: 'completed', conclusion: 'success' }
    await p.create({ collection: 'mirror_checks', data: check, ...o })
  }
}
