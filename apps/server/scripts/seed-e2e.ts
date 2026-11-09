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
const admin = (await ensure('bauherren', { email }, { email, password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: 'e2e-admin' })).id
// A sign-out bumps the user's sessionVersion and ends every session of that user, so a spec that signs out signs in as a user of its own.
for (const [who, login] of [['signout-shell', 'e2e-signout-shell'], ['signout-requests', 'e2e-signout-requests'], ['signout-flow', 'e2e-signout-flow']]) await ensure('bauherren', { email: `${who}@example.com` }, { email: `${who}@example.com`, password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: login })
// one admin per Playwright worker (e2e/user.ts): concurrent logins of one user can lose each other's session
const workerAdmins = [admin]
for (const w of [1, 2]) workerAdmins.push((await ensure('bauherren', { email: email.replace('@', `-w${w}@`) }, { email: email.replace('@', `-w${w}@`), password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: `e2e-admin-w${w}` })).id)
const draftOwner = (await ensure('bauherren', { email: 'draft-owner@example.com' }, { email: 'draft-owner@example.com', password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'admin', githubLogin: 'e2e-draft-owner' })).id // owns the seeded Draft; only requests.spec signs in as this user, and its tests run in one worker
const workspace = (await ensure('workspaces', { slug: 'acme' }, { name: 'Acme', slug: 'acme', wipLimits: {} })).id
await ensure('bauherren', { email: 'member@example.com' }, { email: 'member@example.com', password: readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim(), role: 'bauherr', tenants: [{ tenant: workspace }] })
const zeta = (await ensure('workspaces', { slug: 'zeta' }, { name: 'Zeta', slug: 'zeta' })).id
const password = readFileSync(env('E2E_PASSWORD_FILE'), 'utf8').trim()
await ensure('bauherren', { email: 'solo@example.com' }, { email: 'solo@example.com', password, role: 'bauherr', tenants: [{ tenant: zeta }] })
await ensure('bauherren', { email: 'duo@example.com' }, { email: 'duo@example.com', password, role: 'bauherr', tenants: [{ tenant: workspace }, { tenant: zeta }] })
await ensure('products', { slug: 'zeta-app' }, { name: 'Zeta App', slug: 'zeta-app', workspace: zeta }) // the one Product of a single-Product Workspace
const newco = (await ensure('workspaces', { slug: 'newco' }, { name: 'Newco', slug: 'newco' })).id // stays empty: /setup walks it
await ensure('bauherren', { email: 'setup-member@example.com' }, { email: 'setup-member@example.com', password, role: 'bauherr', tenants: [{ tenant: newco }] })
const product = (await ensure('products', { slug: 'acme-web' }, { name: 'Acme Web', slug: 'acme-web', workspace, stagingUrl: 'https://staging.example.com' })).id
const shop = (await ensure('products', { slug: 'acme-shop' }, { name: 'Acme Shop', slug: 'acme-shop', workspace })).id
const github = (await ensure('connections', { name: 'GitHub Acme' }, { name: 'GitHub Acme', kind: 'github', config: {}, secret: 'ghp_e2e_dummy', workspace })).id
await payload.update({ collection: 'workspaces', id: workspace, data: { knowledgeConnection: github, knowledgeRepo: 'acme/knowledge' }, ...o })
await ensure('repositories', { fullName: 'acme/web' }, { fullName: 'acme/web', product, workspace })
await ensure('ticket_sources', { repo: 'acme/web' }, { repo: 'acme/web', product, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
const seeded = new Set<number>()
const ticket = async (n: number, title: string, stage: string, p: string | number, extra: Record<string, unknown> = {}) => {
  if (seeded.has(n)) throw new Error(`seed-e2e: Ticket number ${n} seeded twice`)
  seeded.add(n)
  return (await ensure('tickets', { externalId: `e2e-${n}` }, {
    title, externalId: `e2e-${n}`, number: n, url: `https://github.com/acme/web/issues/${n}`,
    state: 'open', labels: [`bauherr:stage:${stage}`], stage, product: p, workspace, rank: String(n).padStart(6, '0'), ...extra,
  })).id
}
const run = async (t: string | number, stage: string, status: string, extra: Record<string, unknown> = {}) =>
  ensure('runs', { ticket: t, stage, status }, { ticket: t, stage, status, mode: 'autonomous', workspace, ...extra })

const t1 = await ticket(1, 'Add a dark theme to the dashboard', 'plan', product)
const t2 = await ticket(2, 'Export invoices as CSV', 'build', product)
const t3 = await ticket(3, 'Checkout fails for empty carts', 'build', shop)
await ticket(4, 'Triage the onboarding feedback', 'triage', shop)
const t5 = await ticket(5, 'Upgrade the payment SDK', 'review', shop)
const rel = { stage: 'release', releaseState: 'on_staging', mergeSha: 'abc1234def' }
await ticket(6, 'Ship the CSV export', 'release', product, rel)
await ticket(7, 'Ship the invoice filter', 'release', product, rel)
const blocker = await ticket(8, 'Blocker: migrate the invoice table', 'build', product)
const blocked = await ticket(9, 'Blocked: add the invoice filter', 'build', product, { blockedBy: [blocker] })
await ticket(10, 'Document the invoice filter', 'plan', product, { blockedBy: [blocked] })
const parentTicket = await ticket(11, 'Overhaul invoicing', 'parent', product)
await ticket(12, 'Invoice PDF layout', 'build', product, { parent: parentTicket, inheritedApprovalFrom: parentTicket })
await ticket(13, 'Invoice numbering', 'build', product, { parent: parentTicket, inheritedApprovalFrom: parentTicket, state: 'closed' })
const epic2 = await ticket(31, 'Revamp onboarding', 'parent', product)
await ticket(32, 'Welcome email copy', 'plan', product, { parent: epic2, inheritedApprovalFrom: epic2 })
await ticket(33, 'Signup form validation', 'build', product, { parent: epic2, inheritedApprovalFrom: epic2 })
await ticket(34, 'Signup analytics', 'build', product, { parent: epic2, inheritedApprovalFrom: epic2, state: 'closed' })
const epic3 = await ticket(35, 'Retire the legacy importer', 'done', product, { state: 'closed' })
await ticket(36, 'Remove importer cron', 'build', product, { parent: epic3, inheritedApprovalFrom: epic3, state: 'closed' })
await ticket(14, 'Clarify the export scope', 'triage', product, { stage: null, labels: ['bauherr:needs-refinement'] })
await ticket(17, 'Awaiting close', 'done', product)
await ticket(18, 'Awaiting archive', 'done', product)
const gated = (await ensure('products', { slug: 'acme-gated' }, { name: 'Acme Gated', slug: 'acme-gated', workspace, productionGate: true, productionChecks: 'deploy-prod' })).id
await ensure('repositories', { fullName: 'acme/gated' }, { fullName: 'acme/gated', product: gated, workspace })
await ensure('ticket_sources', { repo: 'acme/gated' }, { repo: 'acme/gated', product: gated, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
await ensure('tickets', { externalId: 'e2e-gated-1' }, { title: 'Ship the gated export', externalId: 'e2e-gated-1', number: 1, url: 'https://github.com/acme/gated/issues/1', state: 'open', labels: ['bauherr:stage:release'], ...rel, product: gated, workspace, rank: '000016' })
const checksProduct = (await ensure('products', { slug: 'acme-checks' }, { name: 'Acme Checks', slug: 'acme-checks', workspace })).id
await ensure('repositories', { fullName: 'acme/checks' }, { fullName: 'acme/checks', product: checksProduct, workspace })
await ensure('ticket_sources', { repo: 'acme/checks' }, { repo: 'acme/checks', product: checksProduct, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
await ticket(15, 'Harden the retry loop', 'review', product, { reviewState: 'needs_human', reviewRounds: 3 })
await ticket(16, 'Ship the export header', 'release', product, rel)
const t17 = await ticket(19, 'Tidy the settings copy', 'plan', product)
const t18 = await ticket(20, 'Fix the date parser', 'build', product)
await ensure('tickets', { externalId: 'e2e-gated-2' }, { title: 'Ship the gated header', externalId: 'e2e-gated-2', number: 2, url: 'https://github.com/acme/gated/issues/2', state: 'open', labels: ['bauherr:stage:release', 'bauherr:approved:staging'], ...rel, productionState: 'awaiting_approval', product: gated, workspace, rank: '000017' })
for (let n = 101; n <= 122; n++) await ticket(n, `Isolated chore ${n}`, n <= 103 ? 'release' : n <= 106 ? 'review' : n <= 112 ? 'build' : n <= 115 ? 'plan' : n <= 118 ? 'triage' : 'done', product)
const t21 = await ticket(21, 'Remember the theme choice', 'plan', product)
const t22 = await ticket(22, 'Pick the export columns', 'plan', product)
// Own Tickets of triage.spec.ts (#23, held by Triage with questions) and of the plan-approval test in ticket.spec.ts (#24, approved there). The numbers follow the fake forge (`src/lib/fake-forge.ts`), which creates them in this order.
await ticket(23, 'Settle the export format', 'triage', product, { stage: null, labels: ['bauherr:needs-refinement'] })
const t24 = await ticket(24, 'Add a light theme to the dashboard', 'plan', product)
// Own Tickets of the next-step button cases in ticket.spec.ts (#385): #25 an approved plan held by an overlap, #26 a plan awaiting approval, #27 a Build with a live Run. Twins in `src/lib/fake-forge.ts` carry these numbers.
await ticket(25, 'Hold the approved export tweak', 'plan', product, { labels: ['bauherr:stage:plan', 'bauherr:approved:plan'], waitingFor: 'build', waitingReason: 'overlaps #356' })
const t26 = await ticket(26, 'Approve the retry policy', 'plan', product)
const t27 = await ticket(27, 'Review the retry policy', 'review', product)
await run(t26, 'plan', 'succeeded', { startedAt: '2026-10-30T09:40:00Z', finishedAt: '2026-10-30T09:42:00Z' })
await ensure('runs', { ticket: t27, stage: 'review', status: 'running' }, { ticket: t27, stage: 'review', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
// Hotfix (#373): a card in the Hotfix lane of Build, and a merged one 12 minutes after its flag for the lead time in Factory health.
await ticket(125, 'Hotfix: checkout crash', 'build', product, { expedite: true, expediteAt: '2026-11-05T08:00:00Z', rank: '999999' })
await ticket(126, 'Hotfix: login loop', 'done', product, { state: 'closed', expedite: true, expediteAt: '2026-11-05T08:00:00Z', releaseAt: '2026-11-05T08:12:00Z' })
await ticket(124, 'Waiting for a Build slot', 'plan', product, { waitingFor: 'build', rank: '000000' })
const live = await ticket(123, 'Live build in progress', 'build', product, { rank: '900000' })
await ensure('runs', { ticket: live, stage: 'build', status: 'running' }, { ticket: live, stage: 'build', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
await run(t17, 'plan', 'succeeded', { startedAt: '2026-10-30T12:00:00Z', finishedAt: '2026-10-30T12:01:00Z' })
await run(t18, 'plan', 'succeeded', { startedAt: '2026-10-30T12:05:00Z', finishedAt: '2026-10-30T12:06:00Z' })
await run(t18, 'build', 'failed', { reasonKind: 'decision', startedAt: '2026-10-30T12:10:00Z', finishedAt: '2026-10-30T12:12:00Z' })
await run(t24, 'plan', 'succeeded', { startedAt: '2026-10-30T09:30:00Z', finishedAt: '2026-10-30T09:32:00Z' })
// The owner-chat spec's Tickets have a plan Run in progress from the start ("the plan is being written" is what its answers lead to), so the spec does not depend on how long the server has been up for the factory to start one.
await ensure('runs', { ticket: t21, stage: 'plan', status: 'running' }, { ticket: t21, stage: 'plan', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
await ensure('runs', { ticket: t22, stage: 'plan', status: 'running' }, { ticket: t22, stage: 'plan', status: 'running', mode: 'autonomous', workspace, startedAt: new Date().toISOString() })
await run(t1, 'plan', 'succeeded', { startedAt: '2026-10-30T09:00:00Z', finishedAt: '2026-10-30T09:02:30Z', costUsd: 0.1234 })
const build = await run(t2, 'build', 'succeeded', { startedAt: '2026-10-30T09:10:00Z', finishedAt: '2026-10-30T09:25:12Z', gatewayCostUsd: 1.5, model: 'claude-sonnet-4-5', tokensIn: 12000, tokensOut: 3400, tokensCache: 8000, evidence: 'Checks: pass', artifacts: { prUrl: 'https://github.com/acme/web/pull/12' } })
const steps = [['09:10:05', 'Read the plan and the repo'], ['09:14:00', 'Implement the CSV export'], ['09:21:30', 'Run the checks']] as const
for (const [i, [at, summary]] of steps.entries()) {
  const step = await ensure('steps', { run: build.id, seq: i + 1 }, { run: build.id, seq: i + 1, summary, startedAt: `2026-10-30T${at}Z`, tokensIn: 4000, tokensOut: 1100, workspace })
  if (i > 0) await ensure('tool_calls', { toolUseId: `e2e-tool-${i}` }, { toolUseId: `e2e-tool-${i}`, step: step.id, run: build.id, name: i === 1 ? 'Edit' : 'run_checks', inputDigest: '{"path":"src/export.ts"}', status: 'ok', durationMs: i === 1 ? 90000 : 120000, workspace })
}
for (const [checkName, sha] of [['e2e', 'sha-a'], ['e2e', 'sha-b'], ['lint', 'sha-a']] as const) await ensure('check_flakes', { ticket: t2, sha, checkName }, { ticket: t2, sha, checkName, outcome: 'flake', workspace })
await ensure('human_touches', { kind: 'approve:plan', ticket: t2 }, { kind: 'approve:plan', ticket: t2, actor: email, at: '2026-10-30T09:05:00Z', workspace })
const widgetOnly = (await ensure('products', { slug: 'acme-widget' }, { name: 'Acme Widget', slug: 'acme-widget', workspace })).id
await ensure('embed_tokens', { name: 'Widget only' }, { name: 'Widget only', product: widgetOnly, tokenHash: 'e2e-widget-only-hash', workspace })
await ensure('workflow_versions', { product }, { version: 1, product, compiled: { stages: [{ name: 'plan' }] }, workspace })
await run(t3, 'build', 'needs_human', { startedAt: '2026-10-30T10:00:00Z' })
// run.spec.ts re-runs this Run: it lives on Acme Checks, which no other spec counts Runs of (overview.spec.ts counts those of Acme Web and Acme Shop).
const stalled = (await ensure('tickets', { externalId: 'e2e-checks-1' }, { title: 'Recover the stalled import', externalId: 'e2e-checks-1', number: 1, url: 'https://github.com/acme/checks/issues/1', state: 'open', labels: ['bauherr:stage:build'], stage: 'build', product: checksProduct, workspace, rank: '000025' })).id
await run(stalled, 'build', 'needs_human', { startedAt: '2026-10-30T10:30:00Z' })
await run(t5, 'review', 'succeeded', {
  startedAt: '2026-10-30T11:00:00Z', finishedAt: '2026-10-30T11:04:00Z', verdict: 'changes',
  findings: [
    { severity: 'medium', file: 'src/payment.ts', line: 42, msg: 'The retry loop never stops on a permanent error.', scenario: 'when the gateway answers 402, then the call is retried forever instead of failing.' },
    { severity: 'low', file: 'src/payment.ts', line: 7, msg: 'Unused import.', scenario: 'lint noise only.' },
  ],
})
// releases.spec.ts: two manual Products of their own, each with done Tickets waiting for a release. Acme Relist is only listed (its releaseAt is old, so the Board reminds), Acme Reship is shipped. Twins in `src/lib/fake-forge.ts` carry these numbers.
for (const [slug, name, repo, titles, releaseAt] of [
  ['acme-relist', 'Acme Relist', 'acme/relist', ['Relist the export totals', 'Relist the invoice filter', 'Relist the CSV header'], '2026-10-01T09:00:00Z'],
  ['acme-reship', 'Acme Reship', 'acme/reship', ['Reship the export totals', 'Reship the invoice filter'], undefined],
] as const) {
  const p = (await ensure('products', { slug }, { name, slug, workspace, releaseMode: 'manual', releaseReminderDays: 7 })).id
  await ensure('repositories', { fullName: repo }, { fullName: repo, product: p, workspace })
  await ensure('ticket_sources', { repo }, { repo, product: p, connection: github, cursor: '2026-10-30T09:00:00Z', workspace })
  for (const [i, title] of titles.entries()) await ensure('tickets', { externalId: `e2e-${slug}-${i + 1}` }, { title, externalId: `e2e-${slug}-${i + 1}`, number: i + 1, url: `https://github.com/${repo}/issues/${i + 1}`, state: 'closed', labels: i === 0 ? ['type:feature'] : [], stage: 'done', mergeSha: `${slug}-sha-${i + 1}`, releaseAt, product: p, workspace, rank: String(200 + i).padStart(6, '0') })
}
const request = async (key: string, status: string, extra: Record<string, unknown>) =>
  ensure('intake_sessions', { 'draft.problem': key }, { product, workspace, status, persona: 'product-user', messages: [], draft: { problem: key, context: '', acceptance_criteria: [], type: 'bug', links: [] }, ...extra })
await request('Export totals drift', 'open', { user: draftOwner })
await request('Dark theme for the dashboard', 'submitted', { ticketNumber: 1 })
await request('Invoice filter and CSV export', 'submitted', { ticketNumber: 6, ticketNumbers: [6, 7] })
console.log('seeded')
process.exit(0)
