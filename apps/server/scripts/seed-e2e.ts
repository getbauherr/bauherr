import { readFileSync } from 'node:fs'
import { getPayload } from 'payload'
import config from '../src/payload.config'

/** Seeds what the Playwright smoke needs on an empty DB: one admin, one Workspace, one Product, one Ticket. Idempotent. */
const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}
const payload = await getPayload({ config })
const o = { overrideAccess: true } as const
const ensure = async (collection: string, where: Record<string, unknown>, data: Record<string, unknown>) => {
  const found = await payload.find({ collection, where: Object.fromEntries(Object.entries(where).map(([k, v]) => [k, { equals: v }])) as never, limit: 1, depth: 0, ...o })
  return found.docs[0] ?? (await payload.create({ collection, data: data as never, ...o }))
}

const email = env('E2E_EMAIL')
await ensure('bauherren', { email }, { email, password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin' })
const workspace = (await ensure('workspaces', { slug: 'acme' }, { name: 'Acme', slug: 'acme' })).id
const product = (await ensure('products', { slug: 'acme-web' }, { name: 'Acme Web', slug: 'acme-web', workspace })).id
const shop = (await ensure('products', { slug: 'acme-shop' }, { name: 'Acme Shop', slug: 'acme-shop', workspace })).id
const github = (await ensure('connections', { name: 'GitHub Acme' }, { name: 'GitHub Acme', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace })).id
await ensure('repositories', { fullName: 'acme/web' }, { fullName: 'acme/web', product, workspace })
await ensure('ticket_sources', { repo: 'acme/web' }, { repo: 'acme/web', product, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
const ticket = async (n: number, title: string, stage: string, p: string | number, extra: Record<string, unknown> = {}) =>
  (await ensure('tickets', { externalId: `e2e-${n}` }, {
    title, externalId: `e2e-${n}`, number: n, url: `https://github.com/acme/web/issues/${n}`,
    state: 'open', labels: [`bauherr:stage:${stage}`], stage, product: p, workspace, ...extra,
  })).id
const run = async (t: string | number, stage: string, status: string, extra: Record<string, unknown> = {}) =>
  ensure('runs', { ticket: t, stage, status }, { ticket: t, stage, status, mode: 'autonomous', workspace, ...extra })

const t1 = await ticket(1, 'Add a dark theme to the dashboard', 'plan', product)
const t2 = await ticket(2, 'Export invoices as CSV', 'build', product)
const t3 = await ticket(3, 'Checkout fails for empty carts', 'build', shop)
await ticket(4, 'Triage the onboarding feedback', 'triage', shop)
await ticket(5, 'Upgrade the payment SDK', 'review', shop)
await run(t1, 'plan', 'succeeded', { startedAt: '2026-10-30T09:00:00Z', finishedAt: '2026-10-30T09:02:30Z', costUsd: 0.1234 })
const build = await run(t2, 'build', 'succeeded', { startedAt: '2026-10-30T09:10:00Z', finishedAt: '2026-10-30T09:25:12Z', gatewayCostUsd: 1.5, model: 'claude-sonnet-4-5', tokensIn: 12000, tokensOut: 3400, tokensCache: 8000, evidence: 'Checks: pass', artifacts: { prUrl: 'https://github.com/acme/web/pull/12' } })
const steps = [['09:10:05', 'Read the plan and the repo'], ['09:14:00', 'Implement the CSV export'], ['09:21:30', 'Run the checks']] as const
for (const [i, [at, summary]] of steps.entries()) {
  const step = await ensure('steps', { run: build.id, seq: i + 1 }, { run: build.id, seq: i + 1, summary, startedAt: `2026-10-30T${at}Z`, tokensIn: 4000, tokensOut: 1100, workspace })
  if (i > 0) await ensure('tool_calls', { toolUseId: `e2e-tool-${i}` }, { toolUseId: `e2e-tool-${i}`, step: step.id, name: i === 1 ? 'Edit' : 'run_checks', inputDigest: '{"path":"src/export.ts"}', status: 'ok', durationMs: i === 1 ? 90000 : 120000, workspace })
}
await run(t3, 'build', 'needs_human', { startedAt: '2026-10-30T10:00:00Z' })
console.log('seeded')
process.exit(0)
