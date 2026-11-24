import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { appendEvent, createRecord } from '../src/core/record/store'
import { fakeForge } from '../src/lib/fake-forge'

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
  const [open] = await fakeForge().forge.listOpenPullRequests(REPO, 1, 10)
  if (!open) throw new Error(`${REPO} has no pull request in the fake forge`)
  const pullData = {
    workspace,
    source,
    product,
    repo: REPO,
    number: open.number,
    kind: 'pr',
    title: open.title,
    state: 'open',
    headSha: open.headSha,
    forgeCreatedAt: new Date().toISOString(),
  }
  const pull = Number((await p.create({ collection: 'mirror_items', data: pullData, ...o })).id)
  for (const name of ['lint', 'test']) {
    const check = { workspace, item: pull, sha: open.headSha, name, status: 'completed', conclusion: 'success' }
    await p.create({ collection: 'mirror_checks', data: check, ...o })
  }
  await seedWaiting(p, { workspace, connection })
}

const seedWaiting = async (p: Payload, f: { workspace: number; connection: number }): Promise<void> => {
  const { workspace, connection } = f
  const repo = 'ready/wait'
  const productData = { name: 'Waiting App', slug: 'waiting-app', workspace, state: 'active' }
  const gates = { requiredChecks: 'test' }
  const product = Number((await p.create({ collection: 'products', data: { ...productData, ...gates }, ...o })).id)
  const sourceData = { repo, product, connection, cursor: '2026-10-30T09:00:00Z', workspace }
  const source = Number((await p.create({ collection: 'ticket_sources', data: sourceData, ...o })).id)
  const itemData = { workspace, source, product, repo, state: 'open', forgeCreatedAt: new Date().toISOString() }
  const [issue] = await fakeForge().tickets(repo).list({ state: 'open' })
  const [pull] = await fakeForge().forge.listOpenPullRequests(repo, 1, 10)
  if (!issue || !pull) throw new Error(`${repo} has no issue and pull request in the fake forge`)
  const issueData = { ...itemData, number: issue.number, kind: 'issue', title: issue.title }
  await p.create({ collection: 'mirror_items', data: issueData, ...o })
  const pullData = { ...itemData, number: pull.number, kind: 'pr', title: pull.title, headSha: pull.headSha }
  await p.create({ collection: 'mirror_items', data: { ...pullData, headRef: pull.head }, ...o })
  const input = {
    workspace,
    product,
    source: { forge: 'github', repo, number: issue.number, reporter: 'jo', external: false, backlog: false },
    type: 'change',
  } as const
  const record = (await createRecord(p, input)).id
  const patch = { runId: '1', patchId: 'p1', headSha: pull.headSha, pr: pull.number }
  await appendEvent(p, record, { type: 'intake.accepted', data: {}, actor: 'factory' })
  await appendEvent(p, record, { type: 'brief.approved', data: { by: 'rule' }, actor: 'factory' })
  await appendEvent(p, record, { type: 'build.submitted', data: patch, actor: 'agent' })
  await p.db.drizzle.execute(
    sql`UPDATE "events" SET "created_at" = now() - interval '3 hours' WHERE "record_id" = ${record}`,
  )
  await p.db.drizzle.execute(
    sql`UPDATE "records" SET "stage" = 'verify', "waiting_on" = 'agents' WHERE "id" = ${record}`,
  )
}
